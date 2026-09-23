import { check } from "../errors.js";
import { bm25Scores, ranked } from "./rank.js";
import { meaningfulTerms } from "./text.js";
/** One authorized exact corpus read for the canonical BM25 baseline. */
export function rankBm25Candidates(db, namespaceId, scopes, terms, options) {
    const rows = db.prepare("SELECT p.start,p.end,p.text,p.tokens,e.id,e.scope_id,e.source_id,e.source_version,e.content_hash FROM passages p JOIN evidence e ON e.id=p.evidence_id JOIN source_heads h ON h.evidence_id=e.id WHERE e.namespace_id=? AND e.scope_id IN (" + scopes.map(() => "?").join(",") + ") AND h.deleted=0" + (options.positionBoundary === undefined ? "" : " AND (h.position IS NULL OR h.position<=?)") + " ORDER BY e.version DESC,p.ordinal LIMIT ?").all(namespaceId, ...scopes, ...(options.positionBoundary === undefined ? [] : [options.positionBoundary]), options.maxCorpusPassages + 1);
    check(rows.length <= options.maxCorpusPassages, "NOT_READY", "Authorized corpus exceeds the configured exact-scan passage limit; narrow the scopes.");
    const passages = rows.map(row => ({
        id: `${String(row.id)}:${Number(row.start)}:${Number(row.end)}`,
        text: String(row.text), tokens: String(row.tokens), scopeId: String(row.scope_id),
        citation: { evidenceId: String(row.id), sourceId: String(row.source_id), sourceVersion: Number(row.source_version), contentHash: String(row.content_hash), start: Number(row.start), end: Number(row.end), offsetUnit: "utf16" },
    }));
    const meaningful = new Set(meaningfulTerms(terms));
    const scores = bm25Scores(passages.map(passage => passage.tokens), terms);
    const order = ranked(scores);
    return {
        corpusPassages: passages.length,
        hasMoreMatches: order.length > options.candidateLimit,
        candidates: order.slice(0, options.candidateLimit).map((index, rank) => {
            const passage = passages[index];
            const available = new Set(passage.tokens.split(" "));
            const matchedTerms = terms.filter(term => available.has(term));
            return { ...passage, score: scores[index], rank: rank + 1, matchedTerms, meaningfulMatchedTerms: matchedTerms.filter(term => meaningful.has(term)), queryTermCount: terms.length };
        }),
    };
}
