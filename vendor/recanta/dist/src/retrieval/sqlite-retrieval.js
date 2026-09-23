import { utf8Length } from "../runtime.js";
import { check } from "../errors.js";
import { id, integer, plainObject, scopes, validateAccess } from "../validation.js";
import { SqliteLexicalIndex } from "./sqlite-index.js";
import { INDEX_VERSION, isBoundary, queryTerms } from "./text.js";
export class SqliteEvidenceRetrieval {
    #db;
    #index;
    #snapshot;
    #evidence;
    #head;
    constructor(db, index, snapshot, evidence, head) { this.#db = db; this.#index = index; this.#snapshot = snapshot; this.#evidence = evidence; this.#head = head; }
    #one(sql, ...params) { return this.#db.prepare(sql).get(...params); }
    #invalidated(evidenceId) { return !!this.#one("SELECT 1 FROM source_lifecycle WHERE evidence_id=? AND kind='invalidated' LIMIT 1", evidenceId); }
    search(access, request) {
        plainObject(request, ["query", "scopes", "subjectId", "limit", "maxQuoteBytes", "minVersion"]);
        const selected = scopes(access, request.scopes, "read");
        const terms = queryTerms(request.query);
        const limit = request.limit ?? 10;
        const maxBytes = request.maxQuoteBytes ?? 8192;
        integer(limit, 1, 50);
        integer(maxBytes, 1, 65536);
        if (request.subjectId !== undefined)
            id(request.subjectId);
        if (request.minVersion !== undefined)
            integer(request.minVersion);
        const version = Number(this.#one("SELECT version FROM namespaces WHERE id=?", access.namespaceId)?.version ?? 0);
        check(request.minVersion === undefined || version >= request.minVersion, "NOT_READY", "The requested committed version is not available.");
        const snapshot = { ...this.#snapshot(access.namespaceId, selected), indexVersion: INDEX_VERSION };
        const candidates = this.#index.candidates(access.namespaceId, selected, terms, limit + 1, request.subjectId);
        const result = { method: "lexical", hits: [], snapshot, version, quoteBytes: 0, omittedForBudget: 0, hasMoreMatches: candidates.length > limit };
        for (const hit of candidates.slice(0, limit)) {
            const bytes = utf8Length(hit.text);
            if (result.quoteBytes + bytes > maxBytes) {
                result.omittedForBudget++;
                continue;
            }
            result.hits.push(hit);
            result.quoteBytes += bytes;
        }
        return result;
    }
    resolve(access, citation, options = {}) {
        plainObject(citation, ["evidenceId", "sourceId", "sourceVersion", "contentHash", "start", "end", "offsetUnit"]);
        id(citation.evidenceId);
        id(citation.sourceId);
        integer(citation.sourceVersion, 1);
        integer(citation.start);
        integer(citation.end, citation.start + 1);
        check(citation.offsetUnit === "utf16" && typeof citation.contentHash === "string" && /^[a-f0-9]{64}$/.test(citation.contentHash), "INVALID_INPUT", "Invalid citation hash or offset convention.");
        plainObject(options, ["requireCurrent"]);
        check(options.requireCurrent === undefined || typeof options.requireCurrent === "boolean", "INVALID_INPUT", "Invalid citation options.");
        const evidence = this.#evidence(access, citation.evidenceId);
        check(evidence.sourceId === citation.sourceId && evidence.sourceVersion === citation.sourceVersion && evidence.contentHash === citation.contentHash, "INVALID_INPUT", "Citation does not match the source identity/version/hash.");
        check(citation.end <= evidence.content.length && isBoundary(evidence.content, citation.start) && isBoundary(evidence.content, citation.end), "INVALID_INPUT", "Citation offsets are outside the source or split a Unicode pair.");
        if (options.requireCurrent !== false) {
            const head = this.#head(access, evidence.scopeId, evidence.sourceId);
            check(head && head.evidence.id === evidence.id && !head.deleted && this.#invalidated(evidence.id) === false, "STALE_SOURCE", "The cited source was superseded, deleted or invalidated; historical access must be explicit.");
        }
        return evidence.content.slice(citation.start, citation.end);
    }
    fresh(access, snapshot) {
        validateAccess(access);
        check(snapshot !== null && typeof snapshot === "object" && snapshot.namespaceId === access.namespaceId, "FORBIDDEN", "Snapshot namespace does not match.");
        check(snapshot.generations !== null && typeof snapshot.generations === "object" && !Array.isArray(snapshot.generations) && Object.getPrototypeOf(snapshot.generations) === Object.prototype && typeof snapshot.indexVersion === "string", "INVALID_INPUT", "Invalid search snapshot.");
        const selected = scopes(access, Object.keys(snapshot.generations), "read");
        for (const value of Object.values(snapshot.generations))
            integer(value);
        this.#index.assertCompatible();
        const current = this.#snapshot(access.namespaceId, selected);
        return snapshot.indexVersion === INDEX_VERSION && selected.every(scope => current.generations[scope] === snapshot.generations[scope]);
    }
}
