import { check, RecantaError } from "../errors.js";
import { id, integer, plainObject, scopes } from "../validation.js";
import { usage } from "../processing/validation.js";
import { utf8Length } from "../runtime.js";
import { INDEX_VERSION, queryTerms } from "./text.js";
import { BM25, RRF_K, bm25Scores, cosineScores, lexicalScores, ranked, reciprocalRankFusion, validateVectors } from "./rank.js";
import { DEFAULT_MAX_CORPUS_PASSAGES } from "./advanced-contracts.js";
/** Bounded exact-scan strategies for evaluation; no persistent vector index. */
export class AdvancedRetrieval {
    #db;
    #store;
    #tx;
    #options;
    constructor(db, store, transaction, options = {}) {
        plainObject(options, ["embeddingProvider", "maxCorpusPassages", "maxEmbeddingBytes", "embeddingTimeoutMs"]);
        integer(options.maxCorpusPassages ?? DEFAULT_MAX_CORPUS_PASSAGES, 1, 10000);
        integer(options.maxEmbeddingBytes ?? 262144, 1, 2097152);
        integer(options.embeddingTimeoutMs ?? 30000, 1, 300000);
        if (options.embeddingProvider) {
            id(options.embeddingProvider.fingerprint);
            check(typeof options.embeddingProvider.embed === "function", "INVALID_INPUT", "Invalid embedding provider.");
        }
        this.#db = db;
        this.#store = store;
        this.#tx = transaction;
        this.#options = { ...options };
    }
    async search(access, request) {
        plainObject(request, ["scopes", "query", "method", "limit", "candidateLimit", "maxQuoteBytes"]);
        request = structuredClone(request);
        const selected = scopes(access, request.scopes, "read");
        const terms = queryTerms(request.query);
        check(["lexical", "bm25", "lexical_bm25_rrf", "dense", "hybrid"].includes(request.method), "INVALID_INPUT", "Unknown retrieval strategy.");
        const limit = request.limit ?? 10;
        const candidateLimit = request.candidateLimit ?? 50;
        const maxQuoteBytes = request.maxQuoteBytes ?? 8192;
        integer(limit, 1, 50);
        integer(candidateLimit, limit, 200);
        integer(maxQuoteBytes, 1, 65536);
        const input = this.#tx("DEFERRED", () => {
            check(this.#db.prepare("SELECT value FROM search_metadata WHERE key='index_version'").get()?.value === INDEX_VERSION, "INDEX_VERSION_MISMATCH", "Retrieval index requires an explicit rebuild.");
            const maxCorpusPassages = this.#options.maxCorpusPassages ?? DEFAULT_MAX_CORPUS_PASSAGES;
            const rows = this.#db.prepare("SELECT p.start,p.end,p.text,p.tokens,e.id,e.scope_id,e.source_id,e.source_version,e.content_hash FROM passages p JOIN evidence e ON e.id=p.evidence_id JOIN source_heads h ON h.evidence_id=e.id WHERE e.namespace_id=? AND e.scope_id IN (" + selected.map(() => "?").join(",") + ") AND h.deleted=0 ORDER BY e.version DESC,p.ordinal LIMIT ?").all(access.namespaceId, ...selected, maxCorpusPassages + 1);
            check(rows.length <= maxCorpusPassages, "NOT_READY", "Authorized corpus exceeds the configured exact-scan passage limit; narrow the scopes.");
            const passages = rows.map(row => ({ text: String(row.text), tokens: String(row.tokens), scopeId: String(row.scope_id), score: 0, citation: { evidenceId: String(row.id), sourceId: String(row.source_id), sourceVersion: Number(row.source_version), contentHash: String(row.content_hash), start: Number(row.start), end: Number(row.end), offsetUnit: "utf16" } }));
            return { passages, version: Number(this.#db.prepare("SELECT version FROM namespaces WHERE id=?").get(access.namespaceId)?.version ?? 0), snapshot: { ...this.#store.snapshot(access, selected), indexVersion: INDEX_VERSION } };
        });
        const tokens = input.passages.map(p => p.tokens);
        const lexical = lexicalScores(tokens, terms);
        const bm25 = bm25Scores(tokens, terms);
        const lexicalOrder = ranked(lexical);
        const bm25Order = ranked(bm25);
        let dense = [];
        let denseOrder = [];
        let providerUsage = null;
        const usesEmbeddings = request.method === "dense" || request.method === "hybrid";
        if (usesEmbeddings) {
            const provider = this.#options.embeddingProvider;
            check(provider, "NOT_READY", "Dense/hybrid retrieval requires an explicitly configured embedding provider.");
            const texts = [request.query, ...input.passages.map(p => p.text)];
            check(texts.reduce((sum, text) => sum + utf8Length(text), 0) <= (this.#options.maxEmbeddingBytes ?? 262144), "INVALID_INPUT", "Embedding input exceeds the configured byte limit.");
            const controller = new AbortController();
            let timer;
            try {
                const response = await Promise.race([
                    provider.embed({ texts, signal: controller.signal }),
                    new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new RecantaError("NOT_READY", "Embedding request timed out.")); }, this.#options.embeddingTimeoutMs ?? 30000); }),
                ]);
                providerUsage = usage(response.usage);
                dense = cosineScores(validateVectors(response.vectors, texts.length));
                denseOrder = ranked(dense, false);
            }
            catch (error) {
                if (error instanceof RecantaError)
                    throw error;
                throw new RecantaError("NOT_READY", "Embedding provider failed.");
            }
            finally {
                if (timer !== undefined)
                    clearTimeout(timer);
            }
        }
        // No database transaction is held over model work; reject stale results explicitly.
        check(this.#store.isSearchFresh(access, input.snapshot), "VERSION_CONFLICT", "Sources or permissions changed during retrieval; repeat the query.");
        const fusion = reciprocalRankFusion(lexicalOrder.slice(0, candidateLimit), denseOrder.slice(0, candidateLimit));
        const lexicalBm25Fusion = reciprocalRankFusion(lexicalOrder.slice(0, candidateLimit), bm25Order.slice(0, candidateLimit));
        const scores = request.method === "hybrid" ? input.passages.map((_, i) => fusion.get(i) ?? 0) : request.method === "lexical_bm25_rrf" ? input.passages.map((_, i) => lexicalBm25Fusion.get(i) ?? 0) : request.method === "dense" ? dense : request.method === "bm25" ? bm25 : lexical;
        const order = request.method === "dense" ? denseOrder : ranked(scores);
        const result = { method: request.method, version: input.version, snapshot: input.snapshot, hits: [], candidates: [], quoteBytes: 0, omittedForBudget: 0, hasMoreMatches: order.length > limit, diagnostics: { corpusPassages: input.passages.length, candidateLimit, bm25: BM25, rrfK: RRF_K, embeddingFingerprint: usesEmbeddings ? this.#options.embeddingProvider.fingerprint : null, usage: providerUsage } };
        result.candidates = order.slice(0, candidateLimit).map((i, rank) => ({ citation: input.passages[i].citation, rank: rank + 1, score: scores[i], lexicalRank: lexicalOrder.includes(i) ? lexicalOrder.indexOf(i) + 1 : null, denseRank: denseOrder.includes(i) ? denseOrder.indexOf(i) + 1 : null }));
        for (const i of order.slice(0, limit)) {
            const { tokens: _, ...hit } = input.passages[i];
            const bytes = utf8Length(hit.text);
            if (result.quoteBytes + bytes > maxQuoteBytes) {
                result.omittedForBudget++;
                continue;
            }
            result.hits.push({ ...hit, score: scores[i] });
            result.quoteBytes += bytes;
        }
        return result;
    }
}
