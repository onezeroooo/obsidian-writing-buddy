import { randomId } from "../runtime.js";
import { check } from "../errors.js";
import { hash, id, scopes, validateAccess } from "../validation.js";
/** Durable processing request, lease, usage, output and terminal-state owner. */
export class SqliteProcessingRuns {
    #db;
    #store;
    #tx;
    constructor(db, store, transaction) { this.#db = db; this.#store = store; this.#tx = transaction; }
    save(run) {
        run.updatedAt = new Date().toISOString();
        this.#db.prepare("UPDATE processing_runs SET status=?,body=? WHERE id=?").run(run.status, JSON.stringify(run), run.id);
    }
    /** A state change is a namespace commit; the run row records that version so it exports incrementally. */
    invalidate(run) {
        this.#db.prepare("UPDATE namespaces SET version=version+1 WHERE id=?").run(run.namespaceId);
        this.#db.prepare("UPDATE scope_versions SET generation=generation+1 WHERE namespace_id=? AND scope_id=?").run(run.namespaceId, run.scopeId);
        const version = Number(this.#db.prepare("SELECT version FROM namespaces WHERE id=?").get(run.namespaceId)?.version ?? 0);
        this.#db.prepare("UPDATE processing_runs SET version=? WHERE id=?").run(version, run.id);
    }
    get(access, processingId) {
        validateAccess(access);
        id(processingId);
        const row = this.#db.prepare("SELECT scope_id,body FROM processing_runs WHERE namespace_id=? AND id=?").get(access.namespaceId, processingId);
        check(row && access.readScopes.includes(String(row.scope_id)), "NOT_FOUND", "Processing run was not found in the authorized scopes.");
        return JSON.parse(String(row.body));
    }
    request(access, evidence, metadata, fingerprint, provider, maxAttempts) {
        scopes(access, [evidence.scopeId], "write");
        const old = this.#db.prepare("SELECT metadata FROM processing_sources WHERE evidence_id=?").get(evidence.id);
        if (old)
            check(old.metadata === JSON.stringify(metadata), "IDEMPOTENCY_CONFLICT", "Source identity already has different authenticated metadata.");
        else {
            if (metadata.derivedFromEvidenceId) {
                const origin = this.#store.evidence(access, metadata.derivedFromEvidenceId);
                check(origin.scopeId === evidence.scopeId, "FORBIDDEN", "Derived evidence must remain in its source scope.");
            }
            this.#db.prepare("INSERT INTO processing_sources VALUES(?,?)").run(evidence.id, JSON.stringify(metadata));
        }
        const existing = this.#db.prepare("SELECT body FROM processing_runs WHERE namespace_id=? AND evidence_id=? AND pipeline_fingerprint=?").get(access.namespaceId, evidence.id, fingerprint);
        if (existing)
            return JSON.parse(String(existing.body));
        const now = new Date().toISOString();
        const run = { id: hash(JSON.stringify(["run-v1", access.namespaceId, evidence.id, fingerprint])).slice(0, 32), namespaceId: access.namespaceId, scopeId: evidence.scopeId, evidenceId: evidence.id, sourceVersion: evidence.sourceVersion, sourceHash: evidence.contentHash, pipelineFingerprint: fingerprint, providerFingerprint: provider, status: "requested", metadata, attempts: 0, maxAttempts, leaseToken: null, leaseUntil: null, output: null, usage: [], dependencies: null, slotRevisions: [], decisions: [], failure: null, createdAt: now, updatedAt: now };
        this.#db.prepare("INSERT INTO processing_runs(id,namespace_id,scope_id,evidence_id,pipeline_fingerprint,status,body) VALUES(?,?,?,?,?,?,?)").run(run.id, run.namespaceId, run.scopeId, evidence.id, fingerprint, run.status, JSON.stringify(run));
        this.invalidate(run);
        return run;
    }
    owned(access, processingId, token) {
        const run = this.get(access, processingId);
        scopes(access, [run.scopeId], "write");
        check(run.status === "processing" && run.leaseToken === token && (run.leaseUntil ?? 0) > Date.now(), "VERSION_CONFLICT", "Processing attempt no longer owns its lease.");
        return run;
    }
    start(access, processingId, fingerprint, timeoutMs) {
        return this.#tx("IMMEDIATE", () => {
            const run = this.get(access, processingId);
            scopes(access, [run.scopeId], "write");
            check(run.pipelineFingerprint === fingerprint, "INVALID_INPUT", "Resume requires the original pipeline configuration.");
            if (["completed", "partial", "superseded"].includes(run.status) || (run.status === "failed" && run.failure?.code === "RETRY_EXHAUSTED"))
                return run;
            const evidence = this.#store.evidence(access, run.evidenceId);
            if (this.#store.sourceHead(access, run.scopeId, evidence.sourceId, { includeDeleted: true }).id !== evidence.id) {
                run.status = "superseded";
                run.leaseToken = null;
                run.leaseUntil = null;
                this.save(run);
                this.invalidate(run);
                return run;
            }
            check(run.status !== "processing" || (run.leaseUntil ?? 0) <= Date.now(), "NOT_READY", "Processing is already running; retry after its lease expires.");
            if (run.attempts >= run.maxAttempts) {
                run.status = "failed";
                run.failure = { code: "RETRY_EXHAUSTED", message: "Processing retry limit exhausted." };
                run.leaseToken = null;
                run.leaseUntil = null;
                this.save(run);
                this.invalidate(run);
                return run;
            }
            run.status = "processing";
            run.attempts++;
            run.leaseToken = randomId();
            run.leaseUntil = Date.now() + timeoutMs + 5000;
            run.failure = null;
            run.dependencies = this.#store.snapshot(access, [run.scopeId]);
            this.save(run);
            this.invalidate(run);
            return run;
        });
    }
    recordUsage(access, processingId, token, usage) {
        this.#tx("IMMEDIATE", () => { const run = this.owned(access, processingId, token); run.usage.push(usage); this.save(run); });
    }
    saveOutput(access, processingId, token, output) {
        this.#tx("IMMEDIATE", () => { const run = this.owned(access, processingId, token); run.output = output; this.save(run); });
    }
    fail(access, processingId, token, failure) {
        return this.#tx("IMMEDIATE", () => {
            const run = this.get(access, processingId);
            scopes(access, [run.scopeId], "write");
            if (run.leaseToken !== token || run.status !== "processing")
                return run;
            run.status = "failed";
            run.failure = failure;
            run.leaseToken = null;
            run.leaseUntil = null;
            this.save(run);
            this.invalidate(run);
            return run;
        });
    }
}
