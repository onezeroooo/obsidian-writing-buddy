import { check } from "../errors.js";
import { hash, id, ids, integer, plainObject, scopes } from "../validation.js";
export const DOCUMENT_STREAM = "documents";
export const documentEventId = (sourceId, revision) => `${sourceId}@${revision}`;
export function validateDocument(document) {
    plainObject(document, ["scopeId", "sourceId", "revision", "content", "contentHash", "kind", "subjectIds", "occurredAt", "position", "streamId", "metadata"]);
    id(document.scopeId);
    id(document.sourceId);
    integer(document.revision, 1);
    check(typeof document.content === "string", "INVALID_INPUT", "Document content must be text.");
    if (document.position !== undefined)
        id(document.position);
    if (document.streamId !== undefined)
        id(document.streamId);
    if (document.subjectIds !== undefined)
        ids(document.subjectIds, true);
    const contentHash = hash(document.content);
    if (document.contentHash !== undefined) {
        check(typeof document.contentHash === "string" && /^[a-f0-9]{64}$/.test(document.contentHash), "INVALID_INPUT", "contentHash must be lowercase SHA-256 hex.");
        check(document.contentHash === contentHash, "INVALID_INPUT", "contentHash does not match the delivered content; refusing a corrupted delivery.");
    }
    return { ...document, contentHash };
}
export function validateRetainOptions(options) {
    plainObject(options, ["defer", "onStale", "expectedSnapshot"]);
    check(options.defer === undefined || typeof options.defer === "boolean", "INVALID_INPUT", "Invalid defer option.");
    check(options.onStale === undefined || options.onStale === "reject" || options.onStale === "ignore", "INVALID_INPUT", "Invalid onStale option.");
}
/** Fact slots whose latest revision still carries a claim citing any of these evidence ids. */
export function affectedFacts(db, access, scopeId, evidenceIds, read) {
    if (!evidenceIds.length)
        return [];
    const rows = db.prepare(`SELECT DISTINCT r.scope_id,r.subject_id,r.predicate FROM claim_revisions r, json_each(r.body,'$.claims') c, json_each(c.value,'$.evidenceIds') e
    WHERE r.namespace_id=? AND r.scope_id=? AND e.value IN (${evidenceIds.map(() => "?").join(",")})
      AND r.revision=(SELECT max(x.revision) FROM claim_revisions x WHERE x.namespace_id=r.namespace_id AND x.scope_id=r.scope_id AND x.subject_id=r.subject_id AND x.predicate=r.predicate)
    ORDER BY r.scope_id,r.subject_id,r.predicate`).all(access.namespaceId, scopeId, ...evidenceIds);
    return rows.map(row => {
        const key = { scopeId: String(row.scope_id), subjectId: String(row.subject_id), predicate: String(row.predicate) };
        return { ...key, status: read(access, key).status };
    });
}
/** Allocates the next namespace commit version and invalidates the scope's snapshots. Caller owns the transaction. */
export function commitVersion(db, namespaceId, scopeId) {
    const current = Number(db.prepare("SELECT version FROM namespaces WHERE id=?").get(namespaceId)?.version ?? 0);
    const version = current + 1;
    integer(version, 1);
    db.prepare("INSERT INTO namespaces(id,version) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version").run(namespaceId, version);
    db.prepare("INSERT INTO scope_versions(namespace_id,scope_id,generation) VALUES(?,?,1) ON CONFLICT(namespace_id,scope_id) DO UPDATE SET generation=generation+1").run(namespaceId, scopeId);
    return version;
}
/**
 * Lifecycle rows are identified by what happened, not by the device: the same transition at the
 * same point of a source's history gets the same id everywhere, so two devices that both record
 * it produce one artifact rather than two.
 */
export function lifecycleId(db, namespaceId, scopeId, sourceId, kind, evidenceId, reason) {
    const sequence = Number(db.prepare("SELECT count(*) AS n FROM source_lifecycle WHERE namespace_id=? AND scope_id=? AND source_id=?").get(namespaceId, scopeId, sourceId)?.n ?? 0);
    return hash(JSON.stringify(["lifecycle-v1", namespaceId, scopeId, sourceId, kind, evidenceId, reason, sequence])).slice(0, 32);
}
export function recordLifecycle(db, context, kind, evidenceId, reason, version, recordedAt) {
    const rowId = lifecycleId(db, context.access.namespaceId, context.scopeId, context.sourceId, kind, evidenceId, reason);
    db.prepare("INSERT INTO source_lifecycle(id,namespace_id,scope_id,source_id,evidence_id,kind,reason,version,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)").run(rowId, context.access.namespaceId, context.scopeId, context.sourceId, evidenceId, kind, reason, version, recordedAt);
    return rowId;
}
export function isInvalidated(db, evidenceId) {
    return !!db.prepare("SELECT 1 FROM source_lifecycle WHERE evidence_id=? AND kind='invalidated' LIMIT 1").get(evidenceId);
}
export function validateReason(reason) {
    if (reason === undefined)
        return null;
    check(typeof reason === "string" && reason.length > 0 && reason.length <= 512 && reason.isWellFormed() && !reason.includes("\0"), "INVALID_INPUT", "Lifecycle reason must be short well-formed text.");
    return reason;
}
export function sourceRevisionCount(db, access, scopeId, sourceId) {
    return Number(db.prepare("SELECT count(*) AS n FROM evidence WHERE namespace_id=? AND scope_id=? AND source_id=?").get(access.namespaceId, scopeId, sourceId)?.n ?? 0);
}
export function latestRun(db, evidenceId) {
    const row = db.prepare("SELECT id,status FROM processing_runs WHERE evidence_id=? ORDER BY rowid DESC LIMIT 1").get(evidenceId);
    return row ? { id: String(row.id), status: String(row.status) } : null;
}
export function scopeParams(access, scopeId, mode) {
    scopes(access, [scopeId], mode);
    return [access.namespaceId, scopeId];
}
