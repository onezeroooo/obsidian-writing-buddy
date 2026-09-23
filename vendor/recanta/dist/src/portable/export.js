import { integer, plainObject, scopes } from "../validation.js";
import { artifactName, assertNoSecrets, envelope, serialize } from "./format.js";
const toEvidence = (row) => ({
    id: String(row.id), namespaceId: String(row.namespace_id), scopeId: String(row.scope_id), streamId: String(row.stream_id), eventId: String(row.event_id),
    sourceId: String(row.source_id), sourceVersion: Number(row.source_version), subjectIds: JSON.parse(String(row.subject_ids)),
    kind: row.kind, content: String(row.content), contentHash: String(row.content_hash), occurredAt: row.occurred_at === null ? null : String(row.occurred_at),
    recordedAt: String(row.recorded_at), version: Number(row.version), payloadHash: String(row.payload_hash),
});
/** A run travels without its lease; an interrupted attempt restores as requestable, never as running. */
function portableRun(run) {
    const copy = { ...run, leaseToken: null, leaseUntil: null };
    if (copy.status === "processing") {
        copy.status = "requested";
        copy.attempts = Math.max(0, copy.attempts - 1);
    }
    return copy;
}
/**
 * Portable knowledge = authoritative rows only: evidence with its extraction output and
 * decisions, fact transitions and lifecycle events. Indexes, slots, snapshots, change feed
 * and the artifact ledger are device-local and rebuilt on import.
 */
export function exportArtifacts(db, access, request) {
    plainObject(request, ["scopes", "afterVersion"]);
    const selected = scopes(access, request.scopes, "read");
    const after = request.afterVersion ?? 0;
    integer(after);
    const placeholders = selected.map(() => "?").join(",");
    const artifacts = [];
    const counts = { evidence: 0, run: 0, fact: 0, lifecycle: 0 };
    let version = after;
    const emit = (kind, scopeId, key, ordinal, suffix, rowVersion, body) => {
        const text = serialize(envelope(kind, access.namespaceId, scopeId, rowVersion, body));
        assertNoSecrets(text);
        artifacts.push({ name: artifactName(kind, scopeId, key, ordinal, suffix), text });
        counts[kind]++;
        version = Math.max(version, rowVersion);
    };
    for (const row of db.prepare(`SELECT * FROM evidence WHERE namespace_id=? AND scope_id IN (${placeholders}) AND version>? ORDER BY version`).all(access.namespaceId, ...selected, after)) {
        const evidence = toEvidence(row);
        const source = db.prepare("SELECT metadata FROM processing_sources WHERE evidence_id=?").get(evidence.id);
        // The evidence file is immutable: the run, which changes state, travels separately.
        const body = { evidence, processing: source ? { metadata: JSON.parse(String(source.metadata)), run: null } : null };
        emit("evidence", evidence.scopeId, evidence.sourceId, evidence.sourceVersion, evidence.id.slice(0, 8), evidence.version, body);
    }
    // Runs at rest only; a leased or merely requested run has nothing another device can use yet.
    for (const row of db.prepare(`SELECT r.body,r.version,e.source_id,e.source_version FROM processing_runs r JOIN evidence e ON e.id=r.evidence_id WHERE r.namespace_id=? AND r.scope_id IN (${placeholders}) AND r.version>? AND r.status IN ('completed','partial','failed','superseded') ORDER BY r.version`).all(access.namespaceId, ...selected, after)) {
        const run = portableRun(JSON.parse(String(row.body)));
        emit("run", run.scopeId, String(row.source_id), Number(row.source_version), `${run.id.slice(0, 8)}-${String(run.attempts).padStart(3, "0")}-${run.status}`, Number(row.version), { run });
    }
    for (const row of db.prepare(`SELECT scope_id,subject_id,predicate,revision,version,payload_hash,body FROM claim_revisions WHERE namespace_id=? AND scope_id IN (${placeholders}) AND version>? ORDER BY version`).all(access.namespaceId, ...selected, after)) {
        const revision = JSON.parse(String(row.body));
        const slot = `${String(row.subject_id)}|${String(row.predicate)}`;
        emit("fact", String(row.scope_id), slot, Number(row.revision), revision.operationId.slice(0, 8).replace(/[^A-Za-z0-9]/g, "_"), Number(row.version), { revision, payloadHash: String(row.payload_hash) });
    }
    for (const row of db.prepare(`SELECT * FROM source_lifecycle WHERE namespace_id=? AND scope_id IN (${placeholders}) AND version>? ORDER BY version`).all(access.namespaceId, ...selected, after)) {
        const body = { id: String(row.id), sourceId: String(row.source_id), evidenceId: row.evidence_id === null ? null : String(row.evidence_id), kind: row.kind, reason: row.reason === null ? null : String(row.reason), recordedAt: String(row.recorded_at) };
        emit("lifecycle", String(row.scope_id), String(row.source_id), "", String(row.id).slice(0, 16), Number(row.version), body);
    }
    return { artifacts, version, counts };
}
