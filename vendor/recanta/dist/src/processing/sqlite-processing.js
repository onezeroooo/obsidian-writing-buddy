import { check } from "../errors.js";
import { SqliteClaims } from "../memory/sqlite-claims.js";
import { MemoryIndex } from "../memory/sqlite-index.js";
import { reconcile } from "./reconcile.js";
import { SqliteProcessingRuns } from "./sqlite-runs.js";
export class SqliteProcessing {
    #db;
    #store;
    #tx;
    #runs;
    constructor(db, store, transaction) { this.#db = db; this.#store = store; this.#tx = transaction; this.#runs = new SqliteProcessingRuns(db, store, transaction); }
    get(...args) { return this.#runs.get(...args); }
    request(...args) { return this.#runs.request(...args); }
    start(...args) { return this.#runs.start(...args); }
    recordUsage(...args) { return this.#runs.recordUsage(...args); }
    saveOutput(...args) { return this.#runs.saveOutput(...args); }
    fail(...args) { return this.#runs.fail(...args); }
    plan(access, processingId, token, candidates, minimumConfidence) {
        return this.#tx("DEFERRED", () => {
            const run = this.#runs.owned(access, processingId, token);
            const evidence = this.#store.evidence(access, run.evidenceId);
            // A positioned source is ordered by its position, not by when it was recorded: a chapter
            // processed late is not stale knowledge, and the host reads its slots by position.
            const positioned = !!this.#db.prepare("SELECT 1 FROM source_heads WHERE namespace_id=? AND scope_id=? AND source_id=? AND position IS NOT NULL").get(access.namespaceId, run.scopeId, evidence.sourceId);
            const snapshot = this.#store.snapshot(access, [run.scopeId]);
            const claims = new SqliteClaims(this.#db);
            const plan = { runId: run.id, leaseToken: token, snapshot, slots: [], decisions: [], writes: [] };
            const states = new Map();
            const seen = new Set();
            for (const candidate of candidates) {
                const n = candidate.normalization;
                if (candidate.raw.intent === "correct" && !candidate.raw.predicate && n.subjectId && n.unit) {
                    const slots = this.#db.prepare("SELECT subject_id,predicate FROM memory_slots WHERE namespace_id=? AND scope_id=? AND subject_id=?").all(access.namespaceId, run.scopeId, n.subjectId);
                    const comparable = slots.filter(slot => String(slot.predicate).endsWith(":" + n.unit));
                    if (comparable.length === 1)
                        n.predicate = String(comparable[0].predicate);
                    else
                        n.ambiguities.push("Elliptical correction requires exactly one comparable subject/unit slot.");
                }
                if (candidate.raw.intent === "retract" && n.subjectId && n.predicate && !n.unit) {
                    const prefix = n.predicate + ":";
                    const comparable = this.#db.prepare("SELECT predicate FROM memory_slots WHERE namespace_id=? AND scope_id=? AND subject_id=? AND (predicate=? OR substr(predicate,1,?)=?)").all(access.namespaceId, run.scopeId, n.subjectId, n.predicate, prefix.length, prefix);
                    if (comparable.length === 1)
                        n.predicate = String(comparable[0].predicate);
                    else
                        n.ambiguities.push("Retraction requires one unambiguous existing predicate/unit.");
                }
                const key = n.subjectId && n.predicate ? { scopeId: run.scopeId, subjectId: n.subjectId, predicate: n.predicate } : null;
                const identity = JSON.stringify(key);
                let state = key ? states.get(identity) ?? claims.read(access, key, {}) : null;
                if (key && !states.has(identity)) {
                    plan.slots.push({ ...key, revision: state.revision });
                    states.set(identity, state);
                }
                const origins = new Map();
                for (const c of state?.claims ?? []) {
                    const row = this.#db.prepare(`SELECT d.body,e.version FROM processing_decisions d JOIN evidence e ON e.id=d.evidence_id WHERE d.namespace_id=? AND d.scope_id=? AND d.claim_id=? ORDER BY e.version LIMIT 1`).get(access.namespaceId, run.scopeId, c.id);
                    // Every revision that supports the claim, so a newer revision of one of those sources can supersede its own part.
                    const sources = c.evidenceIds.map(evidenceId => this.#db.prepare("SELECT source_id,source_version,version FROM evidence WHERE namespace_id=? AND scope_id=? AND id=?").get(access.namespaceId, run.scopeId, evidenceId)).filter((item) => !!item).map(item => ({ sourceId: String(item.source_id), sourceVersion: Number(item.source_version), evidenceVersion: Number(item.version) }));
                    if (row) {
                        const d = JSON.parse(String(row.body));
                        origins.set(c.id, { actorId: d.authority.actorId, approved: d.authority.approval, evidenceVersion: Number(row.version), sources });
                    }
                    else if (plan.decisions.some(d => d.claimId === c.id))
                        origins.set(c.id, { actorId: run.metadata.actorId ?? null, approved: run.metadata.authority === "approved", evidenceVersion: evidence.version, sources });
                    else if (sources.length)
                        origins.set(c.id, { actorId: null, approved: false, evidenceVersion: Math.max(...sources.map(item => item.evidenceVersion)), sources });
                }
                const result = reconcile(candidate, run, state, origins, evidence.version, minimumConfidence, { sourceId: evidence.sourceId, sourceVersion: evidence.sourceVersion, positioned });
                if (key && !positioned) {
                    const claimActivity = Number(this.#db.prepare("SELECT max(version) AS version FROM claim_revisions WHERE namespace_id=? AND scope_id=? AND subject_id=? AND predicate=?").get(access.namespaceId, key.scopeId, key.subjectId, key.predicate)?.version ?? 0);
                    const decisionActivity = Number(this.#db.prepare("SELECT max(e.version) AS version FROM processing_decisions d JOIN evidence e ON e.id=d.evidence_id WHERE d.namespace_id=? AND d.scope_id=? AND d.subject_id=? AND d.predicate=? AND d.run_id<>?").get(access.namespaceId, key.scopeId, key.subjectId, key.predicate, run.id)?.version ?? 0);
                    if (Math.max(claimActivity, decisionActivity) > evidence.version) {
                        result.write = null;
                        result.decision.acceptance = "unresolved";
                        result.decision.relation = "unresolved";
                        result.decision.claimId = null;
                        result.decision.targetIds = [];
                        result.decision.reason = "This fact slot changed after the source was recorded; delayed processing cannot publish older state.";
                    }
                }
                // A new pipeline fingerprint cannot replay previously published source semantics.
                // Reinterpretations remain review records until an explicit correction is supplied.
                const prior = key ? this.#db.prepare("SELECT body FROM processing_decisions WHERE namespace_id=? AND scope_id=? AND evidence_id=? AND subject_id=? AND predicate=? AND run_id<>?").all(access.namespaceId, run.scopeId, run.evidenceId, key.subjectId, key.predicate, run.id) : [];
                if (prior.some(row => JSON.parse(String(row.body)).acceptance === "accepted")) {
                    result.write = null;
                    result.decision.acceptance = "unresolved";
                    result.decision.relation = "unresolved";
                    result.decision.claimId = null;
                    result.decision.targetIds = [];
                    result.decision.reason = "This source already published to this slot; reprocessing cannot duplicate support or resurrect retired claims.";
                }
                const signature = JSON.stringify([key, n.value, candidate.raw.intent, candidate.raw.assertionMode]);
                if (seen.has(signature)) {
                    result.write = null;
                    result.decision.acceptance = "unresolved";
                    result.decision.relation = "unresolved";
                    result.decision.claimId = null;
                    result.decision.reason = "Duplicate candidate in one processing unit.";
                }
                seen.add(signature);
                plan.decisions.push(result.decision);
                if (result.write && state) {
                    plan.writes.push(result.write);
                    const action = result.write.action;
                    const next = action.kind === "support"
                        ? state.claims.map(c => action.targetIds.includes(c.id) ? { ...c, evidenceIds: [...new Set([...c.evidenceIds, ...result.write.evidenceIds])] } : c)
                        : state.claims.filter(c => action.kind === "add" || !action.targetIds.includes(c.id));
                    if (action.kind !== "retract" && action.kind !== "support")
                        next.push({ ...action.assertion, id: result.write.operationId, evidenceCurrent: true });
                    state = { ...state, revision: state.revision + 1, claims: next };
                    states.set(identity, state);
                }
            }
            return plan;
        });
    }
    publish(access, plan) {
        return this.#tx("IMMEDIATE", () => {
            const run = this.#runs.owned(access, plan.runId, plan.leaseToken);
            const evidence = this.#store.evidence(access, run.evidenceId);
            const head = this.#store.sourceHead(access, run.scopeId, evidence.sourceId, { includeDeleted: true });
            check(head.id === evidence.id && head.sourceVersion === run.sourceVersion && head.contentHash === run.sourceHash, "STALE_SOURCE", "Processing source was superseded.");
            check(this.#store.isFresh(access, plan.snapshot), "VERSION_CONFLICT", "Processing scope changed during planning.");
            const claims = new SqliteClaims(this.#db);
            const index = new MemoryIndex(this.#db);
            for (const { revision, ...key } of plan.slots)
                check(claims.read(access, key, {}).revision === revision, "VERSION_CONFLICT", "Processing fact dependency changed.");
            for (const write of plan.writes)
                claims.write(access, write);
            for (const decision of plan.decisions) {
                const key = decision.key;
                this.#db.prepare("INSERT INTO processing_decisions VALUES(?,?,?,?,?,?,?,?,?)").run(decision.candidate.id, run.id, run.namespaceId, run.scopeId, key?.subjectId ?? null, key?.predicate ?? null, decision.claimId, run.evidenceId, JSON.stringify(decision));
            }
            for (const { revision: _, ...key } of plan.slots)
                index.update(run.namespaceId, key);
            run.decisions = plan.decisions;
            run.dependencies = plan.snapshot;
            run.slotRevisions = plan.slots;
            run.status = plan.decisions.some(d => d.acceptance === "unresolved" || d.relation === "conflict") || !!run.output?.unresolved.length || run.output?.coverage?.complete === false ? "partial" : "completed";
            run.failure = null;
            run.leaseToken = null;
            run.leaseUntil = null;
            this.#runs.save(run);
            this.#runs.invalidate(run);
            return run;
        });
    }
    receipt(receipt, run) { return { ...receipt, processingId: run.id, readiness: { evidence: "durable", retrieval: "lexical_ready", memory: run.status } }; }
}
