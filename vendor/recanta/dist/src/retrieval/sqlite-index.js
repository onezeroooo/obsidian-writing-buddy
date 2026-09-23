import { check } from "../errors.js";
import { INDEX_VERSION, lexicalScore, matchExpression, passages } from "./text.js";
const SEARCH_SCHEMA = `
CREATE TABLE passages (
  id INTEGER PRIMARY KEY,
  evidence_id TEXT NOT NULL REFERENCES evidence(id),
  ordinal INTEGER NOT NULL,
  start INTEGER NOT NULL,
  end INTEGER NOT NULL,
  text TEXT NOT NULL,
  tokens TEXT NOT NULL,
  UNIQUE(evidence_id, ordinal)
) STRICT;
CREATE TABLE search_metadata (key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
`;
/**
 * FTS5 is a candidate pre-filter, not the scorer. Runtimes without the module (sql.js
 * builds ship FTS3 only) keep identical results through a bounded scan of the same
 * `passages` projection; the capability is recorded so a projection never silently
 * moves between runtimes with different acceleration structures.
 */
const FTS_SCHEMA = `
CREATE VIRTUAL TABLE passage_fts USING fts5(tokens, content='passages', content_rowid='id', tokenize='unicode61 remove_diacritics 0');
CREATE TRIGGER passages_insert AFTER INSERT ON passages BEGIN
  INSERT INTO passage_fts(rowid,tokens) VALUES(new.id,new.tokens);
END;
CREATE TRIGGER passages_delete AFTER DELETE ON passages BEGIN
  INSERT INTO passage_fts(passage_fts,rowid,tokens) VALUES('delete',old.id,old.tokens);
END;
`;
export function fts5Available(db) {
    try {
        return Number(db.prepare("SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled").get()?.enabled) === 1;
    }
    catch {
        return false;
    }
}
/** Internal projection. The caller owns transactions and trusted scope checks. */
export class SqliteLexicalIndex {
    #db;
    #fts;
    constructor(db) {
        this.#db = db;
        this.#fts = fts5Available(db);
        db.function("recanta_lexical_score", { deterministic: true }, (tokens, query) => lexicalScore(String(tokens), String(query)));
    }
    /** The acceleration structure this runtime can maintain; part of the local index identity. */
    get acceleration() { return this.#fts ? "fts5" : "scan"; }
    initialize(create) {
        if (create) {
            this.#db.exec(SEARCH_SCHEMA);
            if (this.#fts)
                this.#db.exec(FTS_SCHEMA);
            this.rebuild();
        }
        this.assertCompatible();
    }
    assertCompatible() {
        const row = this.#db.prepare("SELECT value FROM search_metadata WHERE key='index_version'").get();
        check(row?.value === INDEX_VERSION, "INDEX_VERSION_MISMATCH", "The lexical projection requires an explicit rebuild for this tokenizer/runtime.");
        const acceleration = this.#db.prepare("SELECT value FROM search_metadata WHERE key='acceleration'").get()?.value;
        check(acceleration === undefined || acceleration === this.acceleration, "INDEX_VERSION_MISMATCH", "The lexical projection was built for a different SQLite build; rebuild the device-local index from portable artifacts on this runtime.");
    }
    /** Local maintenance operation; must run inside the owner's write transaction. */
    rebuild() {
        this.#db.exec("DELETE FROM passages");
        for (const row of this.#db.prepare("SELECT e.id,e.content FROM evidence e JOIN source_heads h ON h.evidence_id=e.id WHERE h.deleted=0").iterate()) {
            this.insert(String(row.id), String(row.content));
        }
        const write = this.#db.prepare("INSERT INTO search_metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
        write.run("index_version", INDEX_VERSION);
        write.run("acceleration", this.acceleration);
    }
    replace(previousEvidenceId, evidenceId, content) {
        this.assertCompatible();
        if (previousEvidenceId)
            this.remove(previousEvidenceId);
        this.insert(evidenceId, content);
    }
    remove(evidenceId) {
        this.#db.prepare("DELETE FROM passages WHERE evidence_id=?").run(evidenceId);
    }
    insert(evidenceId, content) {
        const write = this.#db.prepare("INSERT INTO passages(evidence_id,ordinal,start,end,text,tokens) VALUES(?,?,?,?,?,?)");
        for (const [ordinal, passage] of passages(content).entries())
            write.run(evidenceId, ordinal, passage.start, passage.end, passage.text, passage.tokens);
    }
    candidates(namespace, scopes, terms, limit, subjectId) {
        this.assertCompatible();
        if (terms.length === 0)
            return [];
        const params = [terms.join(" "), namespace, ...scopes];
        let filter = "";
        if (this.#fts) {
            filter += " AND passage_fts MATCH ?";
            params.push(matchExpression(terms));
        }
        if (subjectId !== undefined) {
            filter += " AND EXISTS (SELECT 1 FROM json_each(e.subject_ids) WHERE value=?)";
            params.push(subjectId);
        }
        params.push(limit);
        const from = this.#fts ? "FROM passage_fts JOIN passages p ON p.id=passage_fts.rowid" : "FROM passages p";
        // Authorization and current source-head filtering occur before top-k selection.
        const rows = this.#db.prepare(`SELECT p.start,p.end,p.text,e.id,e.scope_id,e.source_id,e.source_version,e.content_hash,
        recanta_lexical_score(p.tokens,?) AS score
      ${from}
      JOIN evidence e ON e.id=p.evidence_id JOIN source_heads h ON h.evidence_id=e.id
      WHERE e.namespace_id=? AND e.scope_id IN (${scopes.map(() => "?").join(",")}) AND h.deleted=0${filter} AND score>0
      ORDER BY score DESC,e.version DESC,p.ordinal ASC LIMIT ?`).all(...params);
        return rows.map(row => ({
            text: String(row.text), scopeId: String(row.scope_id), score: Number(row.score),
            citation: { evidenceId: String(row.id), sourceId: String(row.source_id), sourceVersion: Number(row.source_version), contentHash: String(row.content_hash), start: Number(row.start), end: Number(row.end), offsetUnit: "utf16" },
        }));
    }
}
