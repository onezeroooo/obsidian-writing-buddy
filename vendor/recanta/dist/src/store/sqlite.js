import { isSqlDatabase, openBuiltinSqlite } from "./driver.js";
import { randomId } from "../runtime.js";
import { check } from "../errors.js";
import { canonicalEvent, feed, hash, id, integer, plainObject, scopes, validateAccess } from "../validation.js";
import { migrate } from "./migrations.js";
import { MemoryIndex } from "../memory/sqlite-index.js";
import { supersedeProcessing } from "../processing/supersede.js";
import { lifecycleId } from "../host/documents.js";
import { SqliteLexicalIndex } from "../retrieval/sqlite-index.js";
import { SqliteEvidenceRetrieval } from "../retrieval/sqlite-retrieval.js";
import { SqliteClaims } from "../memory/sqlite-claims.js";
import { SqliteContextCompiler } from "../context/sqlite-compiler.js";
const placeholders = (values) => values.map(() => "?").join(",");
function toEvidence(row) {
    return {
        id: String(row.id), namespaceId: String(row.namespace_id), scopeId: String(row.scope_id),
        streamId: String(row.stream_id), eventId: String(row.event_id),
        sourceId: String(row.source_id), sourceVersion: Number(row.source_version),
        subjectIds: JSON.parse(String(row.subject_ids)),
        kind: row.kind, content: String(row.content),
        contentHash: String(row.content_hash), occurredAt: row.occurred_at === null ? null : String(row.occurred_at),
        recordedAt: String(row.recorded_at), version: Number(row.version),
    };
}
function receipt(row, duplicate) {
    return {
        evidenceId: String(row.id), version: Number(row.version), duplicate,
        readiness: { evidence: "durable", retrieval: "lexical_ready", memory: "not_requested" },
    };
}
/**
 * Synchronous embedded implementation. All source changes are transactionally durable.
 * The database is either a filename opened through Node's built-in SQLite or an injected
 * `SqlDatabase` driver (browser/mobile hosts). The store owns and closes either one.
 */
export class SqliteEventStore {
    #db;
    #index;
    #claims;
    #retrieval;
    #closed = false;
    #depth = 0;
    get database() { this.#open(); return this.#db; }
    get lexicalIndex() { this.#open(); return this.#index; }
    get claimStore() { this.#open(); return this.#claims; }
    constructor(database, options = {}) {
        check((typeof database === "string" && database.length > 0) || isSqlDatabase(database), "INVALID_INPUT", "A database filename or an SqlDatabase driver is required.");
        check(options !== null && typeof options === "object" && !Array.isArray(options) && Object.keys(options).every(key => key === "rebuildSearchIndex") && (options.rebuildSearchIndex === undefined || typeof options.rebuildSearchIndex === "boolean"), "INVALID_INPUT", "Invalid store options.");
        this.#db = typeof database === "string" ? openBuiltinSqlite(database) : database;
        this.#index = new SqliteLexicalIndex(this.#db);
        this.#claims = new SqliteClaims(this.#db);
        this.#retrieval = new SqliteEvidenceRetrieval(this.#db, this.#index, (namespace, selected) => this.#readSnapshot(namespace, selected), (access, evidenceId) => this.evidence(access, evidenceId), (access, scopeId, sourceId) => this.headRow(access, scopeId, sourceId));
        try {
            this.#db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
            this.#transaction("IMMEDIATE", () => {
                migrate(this.#db, this.#index, options.rebuildSearchIndex);
            });
            this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
        }
        catch (error) {
            this.#db.close();
            this.#closed = true;
            throw error;
        }
    }
    #open() { check(!this.#closed, "CLOSED", "The store is closed."); }
    #one(sql, ...params) {
        return this.#db.prepare(sql).get(...params);
    }
    #all(sql, ...params) {
        return this.#db.prepare(sql).all(...params);
    }
    #run(sql, ...params) {
        this.#db.prepare(sql).run(...params);
    }
    #transaction(mode, action) {
        this.#open();
        const depth = this.#depth++;
        const savepoint = `recanta_${depth}`;
        try {
            this.#db.exec(depth === 0 ? `BEGIN ${mode}` : `SAVEPOINT ${savepoint}`);
            try {
                const result = action();
                this.#db.exec(depth === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
                return result;
            }
            catch (error) {
                this.#db.exec(depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
                throw error;
            }
        }
        finally {
            this.#depth--;
        }
    }
    /** Synchronous component composition only; provider work must stay outside. */
    transaction(mode, action) {
        return this.#transaction(mode, action);
    }
    ingest(access, input, options = {}) {
        this.#open();
        const event = canonicalEvent(input);
        scopes(access, [event.scopeId], "write");
        check(options !== null && typeof options === "object" && !Array.isArray(options) && Object.keys(options).every(key => key === "expectedVersion"), "INVALID_INPUT", "Invalid write options.");
        if (options.expectedVersion !== undefined)
            integer(options.expectedVersion);
        const payloadHash = hash(JSON.stringify(event));
        return this.#transaction("IMMEDIATE", () => {
            this.#index.assertCompatible();
            const previous = this.#one("SELECT * FROM evidence WHERE namespace_id=? AND stream_id=? AND event_id=?", access.namespaceId, event.streamId, event.eventId);
            if (previous) {
                scopes(access, [String(previous.scope_id)], "write");
                check(previous.payload_hash === payloadHash, "IDEMPOTENCY_CONFLICT", "This event identity already has a different payload.");
                return receipt(previous, true);
            }
            const current = Number(this.#one("SELECT version FROM namespaces WHERE id=?", access.namespaceId)?.version ?? 0);
            check(options.expectedVersion === undefined || options.expectedVersion === current, "VERSION_CONFLICT", "Namespace changed since the expected version.");
            const head = this.#one("SELECT source_version,evidence_id,deleted FROM source_heads WHERE namespace_id=? AND scope_id=? AND source_id=?", access.namespaceId, event.scopeId, event.sourceId);
            check(!head || event.sourceVersion > Number(head.source_version), "VERSION_CONFLICT", "Source versions must increase; historical source imports are not supported yet.");
            integer(current + 1, 1);
            const version = current + 1;
            // Identity derives from the event, not from the device: the same source revision with the
            // same payload gets the same id everywhere, so artifacts from two devices converge instead of diverging.
            const evidenceId = hash(JSON.stringify(["evidence-v1", access.namespaceId, event.streamId, event.eventId, payloadHash])).slice(0, 32);
            const recordedAt = new Date().toISOString();
            this.#run("INSERT INTO namespaces(id,version) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version", access.namespaceId, version);
            this.#run(`INSERT INTO evidence(id,namespace_id,scope_id,stream_id,event_id,payload_hash,source_id,source_version,subject_ids,kind,content,content_hash,occurred_at,recorded_at,version)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, evidenceId, access.namespaceId, event.scopeId, event.streamId, event.eventId, payloadHash, event.sourceId, event.sourceVersion, JSON.stringify(event.subjectIds), event.kind, event.content, hash(event.content), event.occurredAt ?? null, recordedAt, version);
            this.#run(`INSERT INTO source_heads(namespace_id,scope_id,source_id,source_version,evidence_id,deleted) VALUES(?,?,?,?,?,0)
        ON CONFLICT(namespace_id,scope_id,source_id) DO UPDATE SET source_version=excluded.source_version,evidence_id=excluded.evidence_id,deleted=0`, access.namespaceId, event.scopeId, event.sourceId, event.sourceVersion, evidenceId);
            // A new revision of a deleted document restores it; the ledger records that explicitly.
            if (head && Number(head.deleted) === 1)
                this.#run("INSERT INTO source_lifecycle(id,namespace_id,scope_id,source_id,evidence_id,kind,reason,version,recorded_at) VALUES(?,?,?,?,?,'restored',NULL,?,?)", lifecycleId(this.#db, access.namespaceId, event.scopeId, event.sourceId, "restored", evidenceId, null), access.namespaceId, event.scopeId, event.sourceId, evidenceId, version, recordedAt);
            this.#run(`INSERT INTO scope_versions(namespace_id,scope_id,generation) VALUES(?,?,1)
        ON CONFLICT(namespace_id,scope_id) DO UPDATE SET generation=generation+1`, access.namespaceId, event.scopeId);
            this.#run("INSERT INTO changes(id,namespace_id,scope_id,evidence_id,version,kind) VALUES(?,?,?,?,?,'evidence.ingested')", randomId(), access.namespaceId, event.scopeId, evidenceId, version);
            this.#index.replace(head && Number(head.deleted) === 0 ? String(head.evidence_id) : undefined, evidenceId, event.content);
            if (head)
                supersedeProcessing(this.#db, String(head.evidence_id));
            return receipt({ id: evidenceId, version }, false);
        });
    }
    evidence(access, evidenceId) {
        this.#open();
        validateAccess(access);
        id(evidenceId);
        const row = this.#one("SELECT * FROM evidence WHERE namespace_id=? AND id=?", access.namespaceId, evidenceId);
        check(row && access.readScopes.includes(String(row.scope_id)), "NOT_FOUND", "Evidence was not found in the authorized scopes.");
        return toEvidence(row);
    }
    /** Latest accepted revision. A deleted document has no current head unless `includeDeleted` is set. */
    sourceHead(access, scopeId, sourceId, options = {}) {
        this.#open();
        plainObject(options, ["includeDeleted"]);
        const row = this.headRow(access, scopeId, sourceId);
        check(row && (options.includeDeleted === true || row.deleted === false), "NOT_FOUND", "Source was not found.");
        return row.evidence;
    }
    /** Head plus lifecycle columns for internal callers; read scope is enforced. */
    headRow(access, scopeId, sourceId) {
        scopes(access, [scopeId], "read");
        id(sourceId);
        const row = this.#one(`SELECT e.*,h.deleted AS head_deleted,h.position AS head_position FROM source_heads h JOIN evidence e ON e.id=h.evidence_id
      WHERE h.namespace_id=? AND h.scope_id=? AND h.source_id=?`, access.namespaceId, scopeId, sourceId);
        if (!row)
            return undefined;
        return { evidence: toEvidence(row), deleted: Number(row.head_deleted) === 1, position: row.head_position === null ? null : String(row.head_position) };
    }
    events(access, request) {
        this.#open();
        const { selected, after, limit } = feed(access, request);
        return this.#all(`SELECT * FROM evidence WHERE namespace_id=? AND scope_id IN (${placeholders(selected)}) AND version>? ORDER BY version LIMIT ?`, access.namespaceId, ...selected, after, limit).map(toEvidence);
    }
    changes(access, request) {
        this.#open();
        const { selected, after, limit } = feed(access, request);
        return this.#all(`SELECT * FROM changes WHERE namespace_id=? AND scope_id IN (${placeholders(selected)}) AND version>? ORDER BY version LIMIT ?`, access.namespaceId, ...selected, after, limit).map(row => ({
            id: String(row.id), evidenceId: String(row.evidence_id), scopeId: String(row.scope_id), version: Number(row.version), kind: "evidence.ingested",
        }));
    }
    snapshot(access, requested) {
        this.#open();
        const selected = scopes(access, requested, "read");
        return this.#transaction("DEFERRED", () => this.#readSnapshot(access.namespaceId, selected));
    }
    #readSnapshot(namespaceId, selected) {
        const rows = this.#all(`SELECT scope_id,generation FROM scope_versions WHERE namespace_id=? AND scope_id IN (${placeholders(selected)})`, namespaceId, ...selected);
        const found = new Map(rows.map(row => [String(row.scope_id), Number(row.generation)]));
        return { namespaceId, generations: Object.fromEntries(selected.map(scope => [scope, found.get(scope) ?? 0])) };
    }
    isFresh(access, snapshot) {
        this.#open();
        validateAccess(access);
        check(snapshot !== null && typeof snapshot === "object" && snapshot.namespaceId === access.namespaceId, "FORBIDDEN", "Snapshot namespace does not match.");
        check(snapshot.generations !== null && typeof snapshot.generations === "object" && !Array.isArray(snapshot.generations) && Object.getPrototypeOf(snapshot.generations) === Object.prototype, "INVALID_INPUT", "Invalid dependency generations.");
        const requested = Object.keys(snapshot.generations);
        for (const value of Object.values(snapshot.generations))
            integer(value);
        const current = this.snapshot(access, requested);
        return requested.every(scope => current.generations[scope] === snapshot.generations[scope]);
    }
    search(access, request) {
        this.#open();
        return this.#transaction("DEFERRED", () => this.#retrieval.search(access, request));
    }
    resolveCitation(access, citation, options = {}) {
        this.#open();
        return this.#transaction("DEFERRED", () => this.#retrieval.resolve(access, citation, options));
    }
    isSearchFresh(access, snapshot) {
        this.#open();
        return this.#transaction("DEFERRED", () => this.#retrieval.fresh(access, snapshot));
    }
    writeClaim(access, request) {
        return this.#transaction("IMMEDIATE", () => {
            const receipt = this.#claims.write(access, request);
            if (!receipt.duplicate)
                new MemoryIndex(this.#db).update(access.namespaceId, request);
            return receipt;
        });
    }
    fact(access, key, options = {}) {
        return this.#transaction("DEFERRED", () => {
            const state = this.#claims.read(access, key, options);
            return { ...state, snapshot: this.#readSnapshot(access.namespaceId, [key.scopeId]) };
        });
    }
    claimHistory(access, request) {
        return this.#transaction("DEFERRED", () => this.#claims.history(access, request));
    }
    compileContext(access, request) {
        this.#open();
        return this.#transaction("DEFERRED", () => new SqliteContextCompiler(this.#db, this.#claims, this.#index, (namespace, selected) => this.#readSnapshot(namespace, selected)).compile(access, request));
    }
    isContextFresh(access, snapshot) {
        return this.isSearchFresh(access, snapshot);
    }
    close() {
        if (!this.#closed) {
            this.#db.close();
            this.#closed = true;
        }
    }
}
