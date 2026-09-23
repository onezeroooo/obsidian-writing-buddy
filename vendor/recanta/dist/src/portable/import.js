import { RecantaError } from "../errors.js";
import { commitVersion, isInvalidated } from "../host/documents.js";
import { MemoryIndex } from "../memory/sqlite-index.js";
import { supersedeProcessing } from "../processing/supersede.js";
import { SqliteLexicalIndex } from "../retrieval/sqlite-index.js";
import { canonicalEvent, id, integer, plainObject } from "../validation.js";
import { randomId } from "../runtime.js";
import { parseArtifact } from "./format.js";
class Skip extends Error {
    reason;
    constructor(reason, message) { super(message); this.reason = reason; }
}
const KIND_ORDER = { evidence: 0, run: 1, lifecycle: 2, fact: 3 };
/** How far along a run is; a later state from another device replaces an earlier one here. */
const RUN_RANK = { requested: 0, processing: 0, failed: 1, superseded: 1, partial: 2, completed: 2 };
/**
 * Applies portable artifacts to the local store. Every artifact is idempotent, order-tolerant
 * within its dependencies and applied under its own savepoint, so a corrupt, foreign or
 * conflicting file can only skip itself. Nothing here invokes a provider: restored runs carry
 * their extraction output, and runs without one are merely listed as needing processing.
 */
export class ArtifactImporter {
    #db;
    #tx;
    #index;
    #head;
    #access;
    constructor(db, transaction, index, head, access) {
        this.#db = db;
        this.#tx = transaction;
        this.#index = index;
        this.#head = head;
        this.#access = access;
    }
    import(artifacts) {
        const report = { applied: { evidence: 0, run: 0, fact: 0, lifecycle: 0 }, skipped: { duplicate: 0, pending: 0, corrupt: 0, incompatible: 0, divergent: 0, forbidden: 0 }, issues: [], pending: [], needsProcessing: [], version: 0 };
        const skip = (name, reason, detail) => { report.skipped[reason]++; if (reason !== "duplicate")
            report.issues.push({ name, reason, detail }); };
        const ready = [];
        return this.#tx("IMMEDIATE", () => {
            for (const artifact of artifacts) {
                plainObject(artifact, ["name", "text"]);
                id(artifact.name);
                const known = this.#db.prepare("SELECT checksum,status FROM artifact_ledger WHERE name=?").get(artifact.name);
                const parsed = parseArtifact(artifact.text);
                if (!parsed.ok) {
                    skip(artifact.name, parsed.reason, parsed.detail);
                    continue;
                }
                if (known && String(known.checksum) === parsed.envelope.checksum && known.status !== "divergent") {
                    report.skipped.duplicate++;
                    continue;
                }
                if (parsed.envelope.namespaceId !== this.#access.namespaceId) {
                    skip(artifact.name, "forbidden", "Artifact belongs to another namespace.");
                    continue;
                }
                if (!this.#access.writeScopes.includes(parsed.envelope.scopeId) || !this.#access.readScopes.includes(parsed.envelope.scopeId)) {
                    skip(artifact.name, "forbidden", "Artifact scope is outside the authorized scopes.");
                    continue;
                }
                ready.push({ name: artifact.name, text: artifact.text, envelope: parsed.envelope });
            }
            ready.sort((a, b) => a.envelope.version - b.envelope.version || KIND_ORDER[a.envelope.kind] - KIND_ORDER[b.envelope.kind] || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
            // Two passes: a dependency that sorts later only happens across origins; one retry resolves it.
            let queue = ready;
            for (let pass = 0; pass < 2 && queue.length; pass++) {
                const deferred = [];
                for (const item of queue) {
                    try {
                        const outcome = this.#tx("IMMEDIATE", () => this.#apply(item.envelope, report));
                        this.#ledger(item.name, item.envelope.checksum, outcome);
                        if (outcome === "applied")
                            report.applied[item.envelope.kind]++;
                        else
                            report.skipped.duplicate++;
                    }
                    catch (error) {
                        if (error instanceof Skip && error.reason === "pending") {
                            deferred.push(item);
                            continue;
                        }
                        if (error instanceof Skip) {
                            skip(item.name, error.reason, error.message);
                            if (error.reason === "divergent")
                                this.#ledger(item.name, item.envelope.checksum, "divergent");
                            continue;
                        }
                        skip(item.name, "corrupt", error instanceof RecantaError ? `${error.code}: ${error.message}` : "Artifact failed validation.");
                    }
                }
                queue = deferred;
            }
            for (const item of queue) {
                report.skipped.pending++;
                report.pending.push(item.name);
                report.issues.push({ name: item.name, reason: "pending", detail: "A dependency (earlier revision, evidence or document) has not arrived yet." });
            }
            report.version = Number(this.#db.prepare("SELECT version FROM namespaces WHERE id=?").get(this.#access.namespaceId)?.version ?? 0);
            return report;
        });
    }
    /** Marks artifacts written by this device as applied so a later import does not reread its own files. */
    recordOwn(artifacts) {
        this.#tx("IMMEDIATE", () => { for (const artifact of artifacts) {
            const parsed = parseArtifact(artifact.text);
            if (parsed.ok)
                this.#ledger(artifact.name, parsed.envelope.checksum, "applied");
        } });
    }
    knownNames() {
        return new Set(this.#db.prepare("SELECT name FROM artifact_ledger WHERE status<>'divergent'").all().map(row => String(row.name)));
    }
    #ledger(name, checksum, status) {
        this.#db.prepare("INSERT INTO artifact_ledger(name,checksum,status,imported_at) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET checksum=excluded.checksum,status=excluded.status,imported_at=excluded.imported_at").run(name, checksum, status, new Date().toISOString());
    }
    #apply(envelope, report) {
        switch (envelope.kind) {
            case "evidence": return this.#evidence(envelope, report);
            case "run": return this.#run(envelope, report);
            case "fact": return this.#fact(envelope);
            case "lifecycle": return this.#lifecycle(envelope);
        }
    }
    #evidence(envelope, report) {
        const body = envelope.body;
        plainObject(body, ["evidence", "processing"]);
        const e = body.evidence;
        plainObject(e);
        id(e.id);
        id(e.payloadHash);
        id(e.contentHash);
        id(e.recordedAt);
        const event = canonicalEvent({ streamId: e.streamId, eventId: e.eventId, scopeId: e.scopeId, sourceId: e.sourceId, sourceVersion: e.sourceVersion, subjectIds: e.subjectIds, kind: e.kind, content: e.content, ...(e.occurredAt === null ? {} : { occurredAt: e.occurredAt }) });
        if (event.scopeId !== envelope.scopeId)
            throw new Skip("corrupt", "Evidence scope does not match its envelope.");
        const ns = this.#access.namespaceId;
        const db = this.#db;
        const existing = db.prepare("SELECT content_hash FROM evidence WHERE namespace_id=? AND id=?").get(ns, e.id);
        if (existing) {
            if (String(existing.content_hash) !== e.contentHash)
                throw new Skip("divergent", "An evidence record with this id but different content already exists.");
            return "duplicate";
        }
        if (db.prepare("SELECT 1 FROM evidence WHERE namespace_id=? AND stream_id=? AND event_id=?").get(ns, event.streamId, event.eventId))
            throw new Skip("divergent", "Another evidence record already claims this event identity.");
        if (db.prepare("SELECT 1 FROM evidence WHERE namespace_id=? AND scope_id=? AND source_id=? AND source_version=?").get(ns, event.scopeId, event.sourceId, event.sourceVersion))
            throw new Skip("divergent", "Another evidence record already claims this source revision.");
        const head = this.#head(event.scopeId, event.sourceId);
        const version = commitVersion(db, ns, event.scopeId);
        db.prepare(`INSERT INTO evidence(id,namespace_id,scope_id,stream_id,event_id,payload_hash,source_id,source_version,subject_ids,kind,content,content_hash,occurred_at,recorded_at,version) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
            .run(e.id, ns, event.scopeId, event.streamId, event.eventId, e.payloadHash, event.sourceId, event.sourceVersion, JSON.stringify(event.subjectIds), event.kind, event.content, e.contentHash, event.occurredAt ?? null, e.recordedAt, version);
        db.prepare("INSERT INTO changes(id,namespace_id,scope_id,evidence_id,version,kind) VALUES(?,?,?,?,?,'evidence.ingested')").run(randomId(), ns, event.scopeId, e.id, version);
        const becomesHead = !head || event.sourceVersion > head.evidence.sourceVersion;
        if (becomesHead) {
            db.prepare("INSERT INTO source_heads(namespace_id,scope_id,source_id,source_version,evidence_id,deleted) VALUES(?,?,?,?,?,0) ON CONFLICT(namespace_id,scope_id,source_id) DO UPDATE SET source_version=excluded.source_version,evidence_id=excluded.evidence_id,deleted=0").run(ns, event.scopeId, event.sourceId, event.sourceVersion, e.id);
            if (head && !head.deleted) {
                this.#index.remove(head.evidence.id);
                supersedeProcessing(db, head.evidence.id);
            }
            this.#index.insert(e.id, event.content);
        }
        if (body.processing) {
            plainObject(body.processing, ["metadata", "run"]);
            if (!db.prepare("SELECT 1 FROM processing_sources WHERE evidence_id=?").get(e.id))
                db.prepare("INSERT INTO processing_sources VALUES(?,?)").run(e.id, JSON.stringify(body.processing.metadata));
            // Older files embed the run; newer ones carry it as its own artifact.
            if (body.processing.run)
                this.#applyRun(body.processing.run, e.id, event.scopeId, version, becomesHead, report);
        }
        return "applied";
    }
    #run(envelope, report) {
        const body = envelope.body;
        plainObject(body, ["run"]);
        const run = body.run;
        plainObject(run);
        id(run.id);
        id(run.evidenceId);
        const ns = this.#access.namespaceId;
        const db = this.#db;
        if (run.namespaceId !== ns || run.scopeId !== envelope.scopeId)
            throw new Skip("corrupt", "Processing run does not belong to its envelope.");
        const evidence = db.prepare("SELECT source_id FROM evidence WHERE namespace_id=? AND scope_id=? AND id=?").get(ns, envelope.scopeId, run.evidenceId);
        if (!evidence)
            throw new Skip("pending", "The evidence this run processed has not arrived yet.");
        const head = this.#head(envelope.scopeId, String(evidence.source_id));
        const version = commitVersion(db, ns, envelope.scopeId);
        return this.#applyRun(run, run.evidenceId, envelope.scopeId, version, head?.evidence.id === run.evidenceId, report);
    }
    /** Inserts a run, or replaces a local run that is behind it; decisions are added, never removed. */
    #applyRun(run, evidenceId, scopeId, version, isHead, report) {
        const ns = this.#access.namespaceId;
        const db = this.#db;
        plainObject(run);
        id(run.id);
        id(run.pipelineFingerprint);
        integer(run.attempts);
        integer(run.maxAttempts, 1);
        if (run.evidenceId !== evidenceId || run.namespaceId !== ns || run.scopeId !== scopeId)
            throw new Skip("corrupt", "Processing run does not belong to its evidence.");
        const restored = { ...run, leaseToken: null, leaseUntil: null, status: run.status === "processing" ? "requested" : run.status };
        const local = db.prepare("SELECT body FROM processing_runs WHERE id=?").get(run.id);
        let outcome = "applied";
        if (!local) {
            db.prepare("INSERT INTO processing_runs(id,namespace_id,scope_id,evidence_id,pipeline_fingerprint,status,body,version) VALUES(?,?,?,?,?,?,?,?)").run(restored.id, ns, scopeId, evidenceId, restored.pipelineFingerprint, restored.status, JSON.stringify(restored), version);
        }
        else {
            const current = JSON.parse(String(local.body));
            const ahead = current.status !== "processing" && current.status !== "superseded" && restored.status !== "superseded"
                && (restored.attempts > current.attempts || (restored.attempts === current.attempts && RUN_RANK[restored.status] > RUN_RANK[current.status]));
            if (!ahead)
                outcome = "duplicate";
            else
                db.prepare("UPDATE processing_runs SET status=?,body=?,version=? WHERE id=?").run(restored.status, JSON.stringify(restored), version, restored.id);
        }
        if (outcome === "applied") {
            for (const decision of restored.decisions) {
                if (db.prepare("SELECT 1 FROM processing_decisions WHERE id=?").get(decision.candidate.id))
                    continue;
                db.prepare("INSERT INTO processing_decisions VALUES(?,?,?,?,?,?,?,?,?)").run(decision.candidate.id, restored.id, ns, scopeId, decision.key?.subjectId ?? null, decision.key?.predicate ?? null, decision.claimId, evidenceId, JSON.stringify(decision));
            }
        }
        if (isHead && !restored.output && ["requested", "failed"].includes(restored.status) && !report.needsProcessing.includes(restored.id))
            report.needsProcessing.push(restored.id);
        return outcome;
    }
    #fact(envelope) {
        const body = envelope.body;
        plainObject(body, ["revision", "payloadHash"]);
        const revision = body.revision;
        plainObject(revision);
        id(body.payloadHash);
        for (const value of [revision.scopeId, revision.subjectId, revision.predicate, revision.operationId])
            id(value);
        integer(revision.revision, 1);
        if (revision.scopeId !== envelope.scopeId)
            throw new Skip("corrupt", "Fact scope does not match its envelope.");
        const ns = this.#access.namespaceId;
        const db = this.#db;
        const key = [ns, revision.scopeId, revision.subjectId, revision.predicate];
        const byOperation = db.prepare("SELECT revision,payload_hash FROM claim_revisions WHERE namespace_id=? AND operation_id=?").get(ns, revision.operationId);
        if (byOperation) {
            if (String(byOperation.payload_hash) !== body.payloadHash)
                throw new Skip("divergent", "This fact operation already exists with a different payload.");
            return "duplicate";
        }
        const current = Number(db.prepare("SELECT max(revision) AS r FROM claim_revisions WHERE namespace_id=? AND scope_id=? AND subject_id=? AND predicate=?").get(...key)?.r ?? 0);
        if (revision.revision <= current)
            throw new Skip("divergent", `Fact slot revision ${revision.revision} was already produced by a different operation on this device; keep both histories and reconcile explicitly.`);
        if (revision.revision > current + 1)
            throw new Skip("pending", "Earlier fact revisions have not arrived yet.");
        const cited = new Set([...revision.evidenceIds, ...revision.claims.flatMap(claim => claim.evidenceIds)]);
        for (const evidenceId of cited)
            if (!db.prepare("SELECT 1 FROM evidence WHERE namespace_id=? AND scope_id=? AND id=?").get(ns, revision.scopeId, evidenceId))
                throw new Skip("pending", "Cited evidence has not arrived yet.");
        const version = commitVersion(db, ns, revision.scopeId);
        const stored = { ...revision, version };
        db.prepare("INSERT INTO claim_revisions VALUES(?,?,?,?,?,?,?,?,?)").run(...key, revision.revision, version, revision.operationId, body.payloadHash, JSON.stringify(stored));
        new MemoryIndex(db).update(ns, { scopeId: revision.scopeId, subjectId: revision.subjectId, predicate: revision.predicate });
        return "applied";
    }
    #lifecycle(envelope) {
        const body = envelope.body;
        plainObject(body, ["id", "sourceId", "evidenceId", "kind", "reason", "recordedAt"]);
        id(body.id);
        id(body.sourceId);
        id(body.recordedAt);
        if (!["deleted", "restored", "invalidated", "positioned"].includes(body.kind))
            throw new Skip("incompatible", `Unknown lifecycle kind ${String(body.kind)}.`);
        const ns = this.#access.namespaceId;
        const db = this.#db;
        const scopeId = envelope.scopeId;
        if (db.prepare("SELECT 1 FROM source_lifecycle WHERE id=?").get(body.id))
            return "duplicate";
        const head = this.#head(scopeId, body.sourceId);
        if (!head)
            throw new Skip("pending", "The document this lifecycle event refers to has not arrived yet.");
        if (body.evidenceId !== null && !db.prepare("SELECT 1 FROM evidence WHERE namespace_id=? AND scope_id=? AND id=?").get(ns, scopeId, body.evidenceId))
            throw new Skip("pending", "Referenced evidence has not arrived yet.");
        const version = commitVersion(db, ns, scopeId);
        const setDeleted = (value) => db.prepare("UPDATE source_heads SET deleted=? WHERE namespace_id=? AND scope_id=? AND source_id=?").run(value, ns, scopeId, body.sourceId);
        if (body.kind === "deleted" && !head.deleted) {
            setDeleted(1);
            this.#index.remove(head.evidence.id);
        }
        else if (body.kind === "restored" && head.deleted) {
            setDeleted(0);
            if (!isInvalidated(db, head.evidence.id))
                this.#index.replace(undefined, head.evidence.id, head.evidence.content);
        }
        else if (body.kind === "invalidated" && body.evidenceId !== null && !isInvalidated(db, body.evidenceId)) {
            this.#index.remove(body.evidenceId);
            supersedeProcessing(db, body.evidenceId);
        }
        else if (body.kind === "positioned") {
            if (body.reason !== null)
                id(body.reason);
            db.prepare("UPDATE source_heads SET position=? WHERE namespace_id=? AND scope_id=? AND source_id=?").run(body.reason, ns, scopeId, body.sourceId);
        }
        db.prepare("INSERT INTO source_lifecycle(id,namespace_id,scope_id,source_id,evidence_id,kind,reason,version,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)").run(body.id, ns, scopeId, body.sourceId, body.evidenceId, body.kind, body.reason, version, body.recordedAt);
        return "applied";
    }
}
export const issueSummary = (issues) => issues.map(issue => `${issue.reason}: ${issue.name} (${issue.detail})`).join("\n");
