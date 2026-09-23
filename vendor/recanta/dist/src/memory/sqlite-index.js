import { lexicalTerms } from "../retrieval/text.js";
export const MEMORY_INDEX_SCHEMA = `
CREATE TABLE memory_slots (
  namespace_id TEXT NOT NULL, scope_id TEXT NOT NULL, subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL, revision INTEGER NOT NULL, tokens TEXT NOT NULL,
  PRIMARY KEY(namespace_id,scope_id,subject_id,predicate)
) STRICT;
`;
/** Rebuildable current-slot projection; source freshness is checked on state reads. */
export class MemoryIndex {
    #db;
    constructor(db) { this.#db = db; }
    update(namespace, key) {
        const row = this.#db.prepare(`SELECT body,revision FROM claim_revisions WHERE namespace_id=? AND scope_id=? AND subject_id=? AND predicate=? ORDER BY revision DESC LIMIT 1`).get(namespace, key.scopeId, key.subjectId, key.predicate);
        if (!row)
            return;
        const state = JSON.parse(String(row.body));
        const aliases = this.#db.prepare(`SELECT body FROM processing_decisions WHERE namespace_id=? AND scope_id=? AND subject_id=? AND predicate=?`).all(namespace, key.scopeId, key.subjectId, key.predicate).map(row => { const d = JSON.parse(String(row.body)); return `${d.candidate.raw.subject} ${d.candidate.raw.predicate} ${d.authority.actorId ?? ""}`; });
        const text = [key.subjectId, key.predicate, ...state.claims.map((c) => String(c.value)), ...new Set(aliases)].join(" ");
        this.#db.prepare(`INSERT INTO memory_slots VALUES(?,?,?,?,?,?) ON CONFLICT(namespace_id,scope_id,subject_id,predicate) DO UPDATE SET revision=excluded.revision,tokens=excluded.tokens`).run(namespace, key.scopeId, key.subjectId, key.predicate, Number(row.revision), lexicalTerms(text).join(" "));
    }
    rebuild() {
        this.#db.exec("DELETE FROM memory_slots");
        for (const row of this.#db.prepare("SELECT DISTINCT namespace_id,scope_id,subject_id,predicate FROM claim_revisions").all())
            this.update(String(row.namespace_id), { scopeId: String(row.scope_id), subjectId: String(row.subject_id), predicate: String(row.predicate) });
    }
    discover(namespace, scopes, terms, limit) {
        if (!terms.length)
            return [];
        const rows = this.#db.prepare(`SELECT scope_id,subject_id,predicate,recanta_lexical_score(tokens,?) AS score FROM memory_slots WHERE namespace_id=? AND scope_id IN (${scopes.map(() => "?").join(",")}) AND score>0 ORDER BY score DESC,scope_id,subject_id,predicate LIMIT ?`).all(terms.join(" "), namespace, ...scopes, limit);
        return rows.map(row => ({ scopeId: String(row.scope_id), subjectId: String(row.subject_id), predicate: String(row.predicate), score: Number(row.score) }));
    }
}
