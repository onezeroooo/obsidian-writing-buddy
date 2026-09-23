import { id, plainObject, scopes } from "./validation.js";
import { SqliteEventStore } from "./store/sqlite.js";
import { SqliteProcessing } from "./processing/sqlite-processing.js";
import { ProcessingCoordinator } from "./processing/coordinator.js";
import { metadata } from "./processing/validation.js";
import { check } from "./errors.js";
import { ContextAssembler } from "./context/assembler.js";
import { AdvancedRetrieval } from "./retrieval/advanced.js";
import { DEFAULT_MAX_CORPUS_PASSAGES } from "./retrieval/advanced-contracts.js";
import { EpisodeRetrieval } from "./retrieval/episodes.js";
import { MemoryInspector } from "./inspector/inspect.js";
import { MemoryIndex } from "./memory/sqlite-index.js";
import { INDEX_VERSION } from "./retrieval/text.js";
import { supersedeProcessing } from "./processing/supersede.js";
import { engineDescription } from "./version.js";
import { DOCUMENT_STREAM, affectedFacts, commitVersion, documentEventId, isInvalidated, latestRun, recordLifecycle, sourceRevisionCount, validateDocument, validateReason, validateRetainOptions } from "./host/documents.js";
import { exportArtifacts } from "./portable/export.js";
import { ArtifactImporter } from "./portable/import.js";
/** Embedded facade; inherited low-level capabilities keep their original contracts. */
export class SqliteRecanta extends SqliteEventStore {
    #runs;
    #processor;
    #retrieval;
    #contextPolicy;
    #maxCorpusPassages;
    constructor(database, options = {}) {
        const { rebuildSearchIndex, retrieval, context, ...processing } = options;
        super(database, rebuildSearchIndex === undefined ? {} : { rebuildSearchIndex });
        try {
            this.#runs = new SqliteProcessing(this.database, this, (mode, action) => this.transaction(mode, action));
            this.#processor = new ProcessingCoordinator(this, this.#runs, processing);
            this.#retrieval = new AdvancedRetrieval(this.database, this, (mode, action) => this.transaction(mode, action), retrieval);
            this.#contextPolicy = context ?? {};
            this.#maxCorpusPassages = retrieval?.maxCorpusPassages ?? DEFAULT_MAX_CORPUS_PASSAGES;
        }
        catch (error) {
            this.close();
            throw error;
        }
    }
    async retain(access, source, options = {}) {
        plainObject(source, ["streamId", "eventId", "scopeId", "sourceId", "sourceVersion", "subjectIds", "kind", "content", "occurredAt", "metadata"]);
        plainObject(options, ["defer", "expectedSnapshot"]);
        check(options.defer === undefined || typeof options.defer === "boolean", "INVALID_INPUT", "Invalid retain options.");
        scopes(access, [source.scopeId], "read");
        scopes(access, [source.scopeId], "write");
        const meta = metadata(source.metadata);
        const { metadata: _, ...raw } = source;
        const result = this.transaction("IMMEDIATE", () => {
            this.#checkSnapshot(access, source.scopeId, options.expectedSnapshot);
            return this.#retainRaw(access, { ...raw, subjectIds: source.subjectIds ?? [] }, meta);
        });
        const run = options.defer ? result.run : await this.#processor.process(access, result.run.id);
        return this.#runs.receipt(result.receipt, run);
    }
    #checkSnapshot(access, scopeId, expected) {
        if (expected === undefined)
            return;
        check(Object.hasOwn(expected?.generations ?? {}, scopeId) && this.isContextFresh(access, expected), "VERSION_CONFLICT", "Context changed before retain; inspect again before correcting.");
    }
    /** Evidence plus its processing request commit together; the caller owns the transaction. */
    #retainRaw(access, raw, meta) {
        const receipt = this.ingest(access, raw);
        const run = this.#runs.request(access, this.evidence(access, receipt.evidenceId), meta, this.#processor.fingerprint, this.#processor.provider.fingerprint, this.#processor.maxAttempts);
        return { receipt, run };
    }
    /**
     * Host document contract: register or replace a document revision by stable identity.
     * Identical content is idempotent without new evidence, an exact replay returns the
     * original receipt, and a revision older than the head is rejected or ignored.
     */
    async retainDocument(access, input, options = {}) {
        const document = validateDocument(input);
        validateRetainOptions(options);
        scopes(access, [document.scopeId], "read");
        scopes(access, [document.scopeId], "write");
        const meta = metadata(document.metadata);
        const streamId = document.streamId ?? DOCUMENT_STREAM;
        const planned = this.transaction("IMMEDIATE", () => {
            this.#checkSnapshot(access, document.scopeId, options.expectedSnapshot);
            const db = this.database;
            const head = this.headRow(access, document.scopeId, document.sourceId);
            const finish = (outcome, evidenceId, revision, contentHash, processingId, affected, readiness) => ({
                receipt: { outcome, sourceId: document.sourceId, revision, contentHash, evidenceId, version: Number(db.prepare("SELECT version FROM namespaces WHERE id=?").get(access.namespaceId)?.version ?? 0), processingId, readiness, affectedFacts: affected },
                runId: null,
            });
            if (head && !head.deleted) {
                const current = head.evidence;
                if (current.contentHash === document.contentHash && !isInvalidated(db, current.id)) {
                    // Same content under any revision: nothing new to learn. Only the position may change.
                    if (document.position !== undefined && document.position !== head.position)
                        this.#reposition(access, document.scopeId, document.sourceId, current.id, document.position);
                    const run = latestRun(db, current.id);
                    const replay = current.sourceVersion === document.revision && current.streamId === streamId;
                    return finish(replay ? "duplicate" : "unchanged", current.id, current.sourceVersion, current.contentHash, run?.id ?? null, [], run ? { evidence: "durable", retrieval: "lexical_ready", memory: run.status } : null);
                }
                if (document.revision <= current.sourceVersion) {
                    const replayed = db.prepare("SELECT id,source_version,content_hash FROM evidence WHERE namespace_id=? AND stream_id=? AND event_id=?").get(access.namespaceId, streamId, documentEventId(document.sourceId, document.revision));
                    if (replayed) {
                        check(String(replayed.content_hash) === document.contentHash, "IDEMPOTENCY_CONFLICT", `Revision ${document.revision} of this document was already delivered with different content.`);
                        const run = latestRun(db, String(replayed.id));
                        return finish("duplicate", String(replayed.id), Number(replayed.source_version), document.contentHash, run?.id ?? null, [], run ? { evidence: "durable", retrieval: "lexical_ready", memory: run.status } : null);
                    }
                    check(options.onStale === "ignore", "VERSION_CONFLICT", `Revision ${document.revision} is older than the accepted head ${current.sourceVersion}; it was not applied.`);
                    return finish("stale", current.id, current.sourceVersion, current.contentHash, latestRun(db, current.id)?.id ?? null, [], null);
                }
            }
            const previous = head && !head.deleted ? [head.evidence.id] : [];
            const { receipt, run } = this.#retainRaw(access, {
                streamId, eventId: documentEventId(document.sourceId, document.revision), scopeId: document.scopeId, sourceId: document.sourceId, sourceVersion: document.revision,
                subjectIds: document.subjectIds ?? [], kind: document.kind ?? "document_revision", content: document.content, ...(document.occurredAt === undefined ? {} : { occurredAt: document.occurredAt }),
            }, meta);
            if (document.position !== undefined && document.position !== (head?.position ?? null))
                this.#reposition(access, document.scopeId, document.sourceId, receipt.evidenceId, document.position);
            const affected = affectedFacts(db, access, document.scopeId, previous, (a, key) => this.claimStore.read(a, key, {}));
            const result = finish(receipt.duplicate ? "duplicate" : "accepted", receipt.evidenceId, document.revision, document.contentHash, run.id, affected, { evidence: "durable", retrieval: "lexical_ready", memory: run.status });
            return { ...result, runId: run.id };
        });
        if (planned.runId === null || options.defer)
            return planned.receipt;
        const run = await this.#processor.process(access, planned.runId);
        return { ...planned.receipt, processingId: run.id, readiness: { evidence: "durable", retrieval: "lexical_ready", memory: run.status } };
    }
    /** Position changes are ledger transitions too, so a rename on one device reaches the others. */
    #reposition(access, scopeId, sourceId, evidenceId, position) {
        const db = this.database;
        db.prepare("UPDATE source_heads SET position=? WHERE namespace_id=? AND scope_id=? AND source_id=?").run(position, access.namespaceId, scopeId, sourceId);
        const version = commitVersion(db, access.namespaceId, scopeId);
        recordLifecycle(db, { db, access, scopeId, sourceId }, "positioned", evidenceId, position, version, new Date().toISOString());
    }
    documentState(access, scopeId, sourceId) {
        return this.transaction("DEFERRED", () => {
            const head = this.headRow(access, scopeId, sourceId);
            check(head, "NOT_FOUND", "Document was not found.");
            const run = latestRun(this.database, head.evidence.id);
            return {
                scopeId, sourceId, deleted: head.deleted, position: head.position,
                head: { revision: head.evidence.sourceVersion, evidenceId: head.evidence.id, contentHash: head.evidence.contentHash, recordedAt: head.evidence.recordedAt, version: head.evidence.version, invalidated: isInvalidated(this.database, head.evidence.id) },
                revisions: sourceRevisionCount(this.database, access, scopeId, sourceId),
                processing: run ? { id: run.id, status: run.status } : null,
            };
        });
    }
    /** Removes a document from current retrieval and memory without discarding its history. */
    deleteDocument(access, scopeId, sourceId, options = {}) {
        plainObject(options, ["reason"]);
        const reason = validateReason(options.reason);
        scopes(access, [scopeId], "write");
        return this.transaction("IMMEDIATE", () => {
            const db = this.database;
            const head = this.headRow(access, scopeId, sourceId);
            check(head, "NOT_FOUND", "Document was not found.");
            const version = Number(db.prepare("SELECT version FROM namespaces WHERE id=?").get(access.namespaceId)?.version ?? 0);
            if (head.deleted)
                return { outcome: "noop", kind: "deleted", scopeId, sourceId, evidenceId: head.evidence.id, version, affectedFacts: [] };
            const next = commitVersion(db, access.namespaceId, scopeId);
            db.prepare("UPDATE source_heads SET deleted=1 WHERE namespace_id=? AND scope_id=? AND source_id=?").run(access.namespaceId, scopeId, sourceId);
            this.lexicalIndex.remove(head.evidence.id);
            recordLifecycle(db, { db, access, scopeId, sourceId }, "deleted", head.evidence.id, reason, next, new Date().toISOString());
            return { outcome: "applied", kind: "deleted", scopeId, sourceId, evidenceId: head.evidence.id, version: next, affectedFacts: affectedFacts(db, access, scopeId, [head.evidence.id], (a, key) => this.claimStore.read(a, key, {})) };
        });
    }
    /** Reverses a deletion; the retained head revision and its processed memory become current again. */
    restoreDocument(access, scopeId, sourceId) {
        scopes(access, [scopeId], "write");
        return this.transaction("IMMEDIATE", () => {
            const db = this.database;
            const head = this.headRow(access, scopeId, sourceId);
            check(head, "NOT_FOUND", "Document was not found.");
            const version = Number(db.prepare("SELECT version FROM namespaces WHERE id=?").get(access.namespaceId)?.version ?? 0);
            if (!head.deleted)
                return { outcome: "noop", kind: "restored", scopeId, sourceId, evidenceId: head.evidence.id, version, affectedFacts: [] };
            const next = commitVersion(db, access.namespaceId, scopeId);
            db.prepare("UPDATE source_heads SET deleted=0 WHERE namespace_id=? AND scope_id=? AND source_id=?").run(access.namespaceId, scopeId, sourceId);
            if (!isInvalidated(db, head.evidence.id))
                this.lexicalIndex.replace(undefined, head.evidence.id, head.evidence.content);
            recordLifecycle(db, { db, access, scopeId, sourceId }, "restored", head.evidence.id, null, next, new Date().toISOString());
            return { outcome: "applied", kind: "restored", scopeId, sourceId, evidenceId: head.evidence.id, version: next, affectedFacts: affectedFacts(db, access, scopeId, [head.evidence.id], (a, key) => this.claimStore.read(a, key, {})) };
        });
    }
    /**
     * Marks one revision's derived knowledge as untrustworthy: its passages leave retrieval,
     * its processing cannot publish, and claims citing it need review until an explicit
     * correction or a newer revision replaces them. The raw evidence stays for provenance.
     */
    invalidateEvidence(access, evidenceId, options = {}) {
        plainObject(options, ["reason"]);
        const reason = validateReason(options.reason);
        id(evidenceId);
        return this.transaction("IMMEDIATE", () => {
            const db = this.database;
            const evidence = this.evidence(access, evidenceId);
            scopes(access, [evidence.scopeId], "write");
            const version = Number(db.prepare("SELECT version FROM namespaces WHERE id=?").get(access.namespaceId)?.version ?? 0);
            if (isInvalidated(db, evidence.id))
                return { outcome: "noop", kind: "invalidated", scopeId: evidence.scopeId, sourceId: evidence.sourceId, evidenceId: evidence.id, version, affectedFacts: [] };
            const next = commitVersion(db, access.namespaceId, evidence.scopeId);
            this.lexicalIndex.remove(evidence.id);
            supersedeProcessing(db, evidence.id);
            recordLifecycle(db, { db, access, scopeId: evidence.scopeId, sourceId: evidence.sourceId }, "invalidated", evidence.id, reason, next, new Date().toISOString());
            return { outcome: "applied", kind: "invalidated", scopeId: evidence.scopeId, sourceId: evidence.sourceId, evidenceId: evidence.id, version: next, affectedFacts: affectedFacts(db, access, evidence.scopeId, [evidence.id], (a, key) => this.claimStore.read(a, key, {})) };
        });
    }
    /** Portable knowledge for the authorized scopes: evidence, extraction output, decisions, fact transitions, lifecycle. */
    exportArtifacts(access, request) {
        return this.transaction("DEFERRED", () => exportArtifacts(this.database, access, request));
    }
    /** Applies artifacts from any device; idempotent, order-tolerant and model-free. See ImportReport for skips. */
    importArtifacts(access, artifacts) {
        return this.#importer(access).import(artifacts);
    }
    /**
     * File-level synchronization against a host storage adapter: writes every local artifact
     * that the store lacks (files are immutable, so presence is sufficient) and imports every
     * store file this device has not applied. Transport between devices is the host's job.
     */
    async syncArtifacts(access, store, request) {
        const importer = this.#importer(access);
        const local = this.exportArtifacts(access, request);
        const present = new Set(await store.list(""));
        const written = [];
        for (const artifact of local.artifacts)
            if (!present.has(artifact.name)) {
                await store.write(artifact.name, artifact.text);
                written.push(artifact);
            }
        importer.recordOwn(local.artifacts);
        const known = importer.knownNames();
        const incoming = [];
        for (const name of present) {
            if (known.has(name))
                continue;
            const text = await store.read(name);
            if (text !== null)
                incoming.push({ name, text });
        }
        return { exported: written.length, imported: importer.import(incoming) };
    }
    #importer(access) {
        return new ArtifactImporter(this.database, (mode, action) => this.transaction(mode, action), this.lexicalIndex, (scopeId, sourceId) => this.headRow(access, scopeId, sourceId), access);
    }
    /** Engine identity, storage schema, local index identity and capability list. */
    engineInfo() { return engineDescription(INDEX_VERSION, this.lexicalIndex.acceleration); }
    /** Rebuilds every device-local projection from authoritative rows. No model call, no artifact needed. */
    rebuildLocalState() {
        return this.transaction("IMMEDIATE", () => {
            this.lexicalIndex.rebuild();
            new MemoryIndex(this.database).rebuild();
            return { passages: Number(this.database.prepare("SELECT count(*) AS n FROM passages").get()?.n ?? 0), slots: Number(this.database.prepare("SELECT count(*) AS n FROM memory_slots").get()?.n ?? 0), indexVersion: INDEX_VERSION, acceleration: this.lexicalIndex.acceleration };
        });
    }
    processingStatus(access, processingId) {
        return this.transaction("DEFERRED", () => {
            const run = this.#runs.get(access, processingId);
            const e = this.evidence(access, run.evidenceId);
            if (this.sourceHead(access, run.scopeId, e.sourceId, { includeDeleted: true }).id !== e.id)
                return { ...run, status: "superseded" };
            return run;
        });
    }
    retryProcessing(access, processingId) { return this.#processor.process(access, processingId); }
    discoverFacts(access, request) {
        return this.transaction("DEFERRED", () => new ContextAssembler(this.database, this, this.#contextPolicy, this.#maxCorpusPassages).discover(access, request));
    }
    recallContext(access, request) {
        return this.transaction("DEFERRED", () => new ContextAssembler(this.database, this, this.#contextPolicy, this.#maxCorpusPassages).recall(access, request));
    }
    searchAdvanced(access, request) { return this.#retrieval.search(access, request); }
    searchEpisodes(access, request) { return this.transaction("DEFERRED", () => new EpisodeRetrieval(this.database, this).search(access, request)); }
    inspectContext(access, request) { return this.transaction("DEFERRED", () => { const detail = new ContextAssembler(this.database, this, this.#contextPolicy, this.#maxCorpusPassages).inspect(access, request); return new MemoryInspector(this.database, this).context(access, request, detail.context, detail.plan); }); }
    healthState(access, requested) {
        return this.transaction("DEFERRED", () => {
            const selected = scopes(access, requested, "read");
            const rows = this.database.prepare(`SELECT COALESCE(r.status,'not_requested') AS status,COUNT(*) AS count FROM source_heads h JOIN evidence e ON e.id=h.evidence_id LEFT JOIN processing_runs r ON r.id=(SELECT id FROM processing_runs WHERE evidence_id=e.id ORDER BY rowid DESC LIMIT 1) WHERE h.namespace_id=? AND h.deleted=0 AND h.scope_id IN (${selected.map(() => "?").join(",")}) GROUP BY COALESCE(r.status,'not_requested')`).all(access.namespaceId, ...selected);
            const counts = { requested: 0, processing: 0, completed: 0, partial: 0, failed: 0, superseded: 0, not_requested: 0 };
            for (const row of rows)
                counts[String(row.status)] = Number(row.count);
            const version = Number(this.database.prepare("SELECT version FROM namespaces WHERE id=?").get(access.namespaceId)?.version ?? 0);
            return { version, counts, ready: counts.requested === 0 && counts.processing === 0 && counts.partial === 0 && counts.failed === 0 && counts.not_requested === 0 };
        });
    }
    inspectEvidence(access, evidenceId) { return this.transaction("DEFERRED", () => new MemoryInspector(this.database, this).evidence(access, evidenceId)); }
}
