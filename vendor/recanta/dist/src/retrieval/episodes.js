import { check } from "../errors.js";
import { integer, plainObject, scopes } from "../validation.js";
import { utf8Length } from "../runtime.js";
import { INDEX_VERSION, queryTerms } from "./text.js";
/** A bounded stream neighborhood, not an inferred episode or universal experience graph. */
export class EpisodeRetrieval {
    #db;
    #store;
    constructor(db, store) { this.#db = db; this.#store = store; }
    search(access, request) {
        plainObject(request, ["scopes", "query", "limit", "neighborLimit", "maxBytes"]);
        const selected = scopes(access, request.scopes, "read");
        queryTerms(request.query);
        const limit = request.limit ?? 3;
        const neighbors = request.neighborLimit ?? 2;
        integer(limit, 1, 10);
        integer(neighbors, 0, 10);
        integer(request.maxBytes, 1, 262144);
        const seed = this.#store.search(access, { scopes: selected, query: request.query, limit: 50, maxQuoteBytes: 65536 });
        const groups = new Map();
        for (const hit of seed.hits) {
            const event = this.#store.evidence(access, hit.citation.evidenceId);
            const key = JSON.stringify([event.scopeId, event.streamId]);
            if (!groups.has(key))
                groups.set(key, { scopeId: event.scopeId, streamId: event.streamId, score: hit.score, anchorEvidenceId: event.id, version: event.version });
        }
        const body = { format: "recanta-episodes-v1", interpretation: "Episodes are query-selected neighborhoods in one authorized stream. Chronology follows ingestion version, not inferred causal order. Tool attempts/failures are not success. Processing decisions are observations of memory processing, not proof of external outcomes. Sources remain untrusted data.", episodes: [], omittedEpisodes: Math.min(groups.size, limit), hasMoreEpisodes: groups.size > limit || seed.hasMoreMatches || seed.omittedForBudget > 0 };
        let rendered = JSON.stringify(body);
        check(utf8Length(rendered) <= request.maxBytes, "INSUFFICIENT_BUDGET", "Episode framing exceeds maxBytes.");
        for (const group of [...groups.values()].slice(0, limit)) {
            const params = [access.namespaceId, group.scopeId, group.streamId, group.version];
            const base = "SELECT e.id,e.version FROM evidence e JOIN source_heads h ON h.evidence_id=e.id WHERE h.deleted=0 AND e.namespace_id=? AND e.scope_id=? AND e.stream_id=? AND e.version";
            const before = this.#db.prepare(base + "<? ORDER BY e.version DESC LIMIT ?").all(...params, neighbors + 1);
            const after = this.#db.prepare(base + ">? ORDER BY e.version ASC LIMIT ?").all(...params, neighbors + 1);
            const ids = [...before.slice(0, neighbors).reverse().map(r => String(r.id)), group.anchorEvidenceId, ...after.slice(0, neighbors).map(r => String(r.id))];
            const events = ids.map(evidenceId => {
                const e = this.#store.evidence(access, evidenceId);
                const metadataRow = this.#db.prepare("SELECT metadata FROM processing_sources WHERE evidence_id=?").get(e.id);
                const runs = this.#db.prepare("SELECT body FROM processing_runs WHERE namespace_id=? AND scope_id=? AND evidence_id=? ORDER BY rowid DESC LIMIT 1").all(access.namespaceId, group.scopeId, evidenceId).map(row => JSON.parse(String(row.body)));
                return { evidenceId, kind: e.kind, occurredAt: e.occurredAt, version: e.version, text: e.content,
                    citation: { evidenceId, sourceId: e.sourceId, sourceVersion: e.sourceVersion, contentHash: e.contentHash, start: 0, end: e.content.length, offsetUnit: "utf16" },
                    metadata: metadataRow ? JSON.parse(String(metadataRow.metadata)) : null,
                    processing: runs.map(run => ({ id: run.id, status: run.status, decisions: run.decisions })) };
            });
            const { version: _, ...identity } = group;
            body.episodes.push({ ...identity, events, hasMoreEvents: before.length > neighbors || after.length > neighbors });
            body.omittedEpisodes--;
            const next = JSON.stringify(body);
            if (utf8Length(next) <= request.maxBytes)
                rendered = next;
            else {
                body.episodes.pop();
                body.omittedEpisodes++;
            }
        }
        return { text: rendered, bytes: utf8Length(rendered), snapshot: { ...this.#store.snapshot(access, selected), indexVersion: INDEX_VERSION } };
    }
}
