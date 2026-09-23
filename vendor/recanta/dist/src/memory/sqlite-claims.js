import { utf8Length } from "../runtime.js";
import { check } from "../errors.js";
import { hash, id, ids, integer, plainObject, scopes } from "../validation.js";
export const CLAIM_SCHEMA = `
CREATE TABLE claim_revisions (
  namespace_id TEXT NOT NULL REFERENCES namespaces(id),
  scope_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  version INTEGER NOT NULL CHECK(version > 0),
  operation_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY(namespace_id,scope_id,subject_id,predicate,revision),
  UNIQUE(namespace_id,operation_id),
  UNIQUE(namespace_id,version)
) STRICT;
`;
function assertion(input) {
    plainObject(input, ["value", "mode", "evidenceIds"]);
    const value = input.value;
    check(typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) || (typeof value === "string" && value.length > 0 && value.isWellFormed() && !value.includes("\0") && utf8Length(value) <= 4096), "INVALID_INPUT", "Fact values must be finite numbers, booleans or nonempty text up to 4096 bytes.");
    check(["asserted", "proposed", "inferred"].includes(input.mode), "INVALID_INPUT", "Invalid assertion mode.");
    ids(input.evidenceIds);
    return { value: Object.is(value, -0) ? 0 : value, mode: input.mode, evidenceIds: [...input.evidenceIds].sort() };
}
function canonical(input) {
    plainObject(input, ["scopeId", "subjectId", "predicate", "operationId", "expectedRevision", "cardinality", "evidenceIds", "action"]);
    for (const value of [input.scopeId, input.subjectId, input.predicate, input.operationId])
        id(value);
    integer(input.expectedRevision);
    ids(input.evidenceIds);
    check(input.cardinality === "single" || input.cardinality === "multiple", "INVALID_INPUT", "Invalid cardinality.");
    const a = input.action;
    plainObject(a, ["kind", "assertion", "targetIds", "reason"]);
    let action;
    if (a.kind === "add") {
        plainObject(a, ["kind", "assertion"]);
        action = { kind: "add", assertion: assertion(a.assertion) };
    }
    else if (a.kind === "replace") {
        ids(a.targetIds);
        check(a.reason === "correction" || a.reason === "supersession", "INVALID_INPUT", "Replacement requires an explicit reason.");
        action = { kind: "replace", targetIds: [...a.targetIds].sort(), reason: a.reason, assertion: assertion(a.assertion) };
    }
    else {
        plainObject(a, ["kind", "targetIds"]);
        check(a.kind === "retract" || a.kind === "support", "INVALID_INPUT", "Invalid claim action.");
        ids(a.targetIds);
        if (a.kind === "support")
            check(input.evidenceIds.length > 0, "INVALID_INPUT", "Support requires transition evidence.");
        action = { kind: a.kind, targetIds: [...a.targetIds].sort() };
    }
    return { scopeId: input.scopeId, subjectId: input.subjectId, predicate: input.predicate, operationId: input.operationId, expectedRevision: input.expectedRevision, cardinality: input.cardinality, evidenceIds: [...input.evidenceIds].sort(), action };
}
/** Internal adapter component. The owner wraps every method in one transaction. */
export class SqliteClaims {
    #db;
    constructor(db) { this.#db = db; }
    #one(sql, ...args) { return this.#db.prepare(sql).get(...args); }
    #run(sql, ...args) { this.#db.prepare(sql).run(...args); }
    #key(access, key, mode) {
        scopes(access, [key.scopeId], mode);
        id(key.subjectId);
        id(key.predicate);
        return [access.namespaceId, key.scopeId, key.subjectId, key.predicate];
    }
    /**
     * Evidence is current at a knowledge boundary when no newer revision of its source had
     * committed, the source was not deleted at that boundary, and the revision was not
     * invalidated. Deletion/restoration are evaluated from the lifecycle ledger, so known-at
     * reads never resurrect state that a later restoration made visible again.
     */
    #currentEvidence(namespace, scope, evidenceId, version) {
        return !!this.#one(`SELECT e.id FROM evidence e WHERE e.namespace_id=? AND e.scope_id=? AND e.id=? AND e.version<=?
      AND NOT EXISTS (SELECT 1 FROM evidence newer WHERE newer.namespace_id=e.namespace_id AND newer.scope_id=e.scope_id AND newer.source_id=e.source_id AND newer.version<=? AND newer.source_version>e.source_version)
      AND NOT EXISTS (SELECT 1 FROM source_lifecycle l WHERE l.evidence_id=e.id AND l.kind='invalidated' AND l.version<=?)
      AND COALESCE((SELECT l.kind FROM source_lifecycle l WHERE l.namespace_id=e.namespace_id AND l.scope_id=e.scope_id AND l.source_id=e.source_id AND l.kind IN ('deleted','restored') AND l.version<=? ORDER BY l.version DESC LIMIT 1),'restored')<>'deleted'`, namespace, scope, evidenceId, version, version, version, version);
    }
    /** A positioned source beyond the requested boundary is invisible; unpositioned sources always count. */
    #withinBoundary(namespace, scope, evidenceId, boundary) {
        return !!this.#one("SELECT 1 FROM evidence e JOIN source_heads h ON h.namespace_id=e.namespace_id AND h.scope_id=e.scope_id AND h.source_id=e.source_id WHERE e.namespace_id=? AND e.scope_id=? AND e.id=? AND (h.position IS NULL OR h.position<=?)", namespace, scope, evidenceId, boundary);
    }
    write(access, input) {
        const request = canonical(input);
        const key = this.#key(access, request, "write");
        this.#key(access, request, "read");
        const payload = hash(JSON.stringify(request));
        const previous = this.#one("SELECT * FROM claim_revisions WHERE namespace_id=? AND operation_id=?", access.namespaceId, request.operationId);
        if (previous) {
            scopes(access, [String(previous.scope_id)], "read");
            scopes(access, [String(previous.scope_id)], "write");
            check(previous.payload_hash === payload, "IDEMPOTENCY_CONFLICT", "Operation identity already has a different payload.");
            return { operationId: request.operationId, revision: Number(previous.revision), version: Number(previous.version), duplicate: true };
        }
        const head = this.#one("SELECT body FROM claim_revisions WHERE namespace_id=? AND scope_id=? AND subject_id=? AND predicate=? ORDER BY revision DESC LIMIT 1", ...key);
        const old = head ? JSON.parse(String(head.body)) : undefined;
        check(request.expectedRevision === (old?.revision ?? 0), "VERSION_CONFLICT", "Fact slot changed; reread before retrying.");
        check(!old || old.cardinality === request.cardinality, "INVALID_INPUT", "Slot cardinality cannot change.");
        const current = Number(this.#one("SELECT version FROM namespaces WHERE id=?", access.namespaceId)?.version ?? 0);
        const evidenceIds = [...request.evidenceIds, ...(request.action.kind === "retract" || request.action.kind === "support" ? [] : request.action.assertion.evidenceIds)];
        for (const evidenceId of evidenceIds) {
            const evidence = this.#one("SELECT id FROM evidence WHERE namespace_id=? AND scope_id=? AND id=?", access.namespaceId, request.scopeId, evidenceId);
            check(evidence, "NOT_FOUND", "Claim evidence must exist in the same authorized scope.");
            check(this.#currentEvidence(access.namespaceId, request.scopeId, evidenceId, current), "STALE_SOURCE", "New transitions require current evidence.");
        }
        let claims = old?.claims ?? [];
        const action = request.action;
        if (action.kind !== "add") {
            check(action.targetIds.every(target => claims.some(claim => claim.id === target)), "VERSION_CONFLICT", "Every target must be active in this fact slot.");
            if (action.kind === "replace" && action.assertion.mode !== "asserted") {
                check(!claims.some(claim => action.targetIds.includes(claim.id) && claim.mode === "asserted"), "INVALID_INPUT", "A proposal or inference cannot replace an asserted fact.");
            }
            if (action.kind === "support")
                claims = claims.map(claim => action.targetIds.includes(claim.id) ? { ...claim, evidenceIds: [...new Set([...claim.evidenceIds, ...request.evidenceIds])].sort() } : claim);
            else
                claims = claims.filter(claim => !action.targetIds.includes(claim.id));
        }
        if (action.kind !== "retract" && action.kind !== "support")
            claims = [...claims, { id: request.operationId, ...action.assertion }];
        check(claims.length <= 64, "INVALID_INPUT", "A slot supports at most 64 active assertions; resolve or retract before adding more.");
        const revision = request.expectedRevision + 1;
        const version = current + 1;
        integer(revision, 1);
        integer(version, 1);
        const body = { scopeId: request.scopeId, subjectId: request.subjectId, predicate: request.predicate, operationId: request.operationId, revision, version, recordedAt: new Date().toISOString(), cardinality: request.cardinality, action, evidenceIds: request.evidenceIds, claims };
        this.#run("UPDATE namespaces SET version=? WHERE id=?", version, access.namespaceId);
        this.#run("INSERT INTO claim_revisions VALUES(?,?,?,?,?,?,?,?,?)", ...key, revision, version, request.operationId, payload, JSON.stringify(body));
        this.#run(`INSERT INTO scope_versions VALUES(?,?,1) ON CONFLICT(namespace_id,scope_id) DO UPDATE SET generation=generation+1`, access.namespaceId, request.scopeId);
        return { operationId: request.operationId, revision, version, duplicate: false };
    }
    read(access, key, options) {
        plainObject(key, ["scopeId", "subjectId", "predicate"]);
        const params = this.#key(access, key, "read");
        plainObject(options, ["knownAtVersion", "positionBoundary"]);
        if (options.positionBoundary !== undefined)
            id(options.positionBoundary);
        const current = Number(this.#one("SELECT version FROM namespaces WHERE id=?", access.namespaceId)?.version ?? 0);
        const version = options.knownAtVersion ?? current;
        integer(version);
        check(version <= current, "NOT_READY", "The requested knowledge boundary has not committed.");
        const boundary = options.positionBoundary;
        let body;
        if (boundary === undefined) {
            const row = this.#one("SELECT body FROM claim_revisions WHERE namespace_id=? AND scope_id=? AND subject_id=? AND predicate=? AND version<=? ORDER BY revision DESC LIMIT 1", ...params, version);
            body = row ? JSON.parse(String(row.body)) : undefined;
        }
        else {
            // Story-position semantics: the slot as it stood after the latest transition whose own
            // evidence lies within the boundary. Later transitions (a correction in a later chapter)
            // are not yet known there, so the earlier state is reconstructed, not merely filtered.
            for (const row of this.#db.prepare("SELECT body FROM claim_revisions WHERE namespace_id=? AND scope_id=? AND subject_id=? AND predicate=? AND version<=? ORDER BY revision DESC").all(...params, version)) {
                const candidate = JSON.parse(String(row.body));
                if (candidate.evidenceIds.every(evidenceId => this.#withinBoundary(access.namespaceId, key.scopeId, evidenceId, boundary))) {
                    body = candidate;
                    break;
                }
            }
        }
        const visible = (body?.claims ?? []).filter(claim => boundary === undefined || claim.evidenceIds.some(evidenceId => this.#withinBoundary(access.namespaceId, key.scopeId, evidenceId, boundary)));
        // A claim stays current while any revision that supports it is current: an early chapter
        // edited away does not retire a fact a later chapter still states.
        const claims = visible.map(claim => ({ ...claim, evidenceCurrent: claim.evidenceIds.some(evidenceId => this.#currentEvidence(access.namespaceId, key.scopeId, evidenceId, version)) }));
        const asserted = claims.filter(claim => claim.mode === "asserted");
        const values = [...new Set(asserted.map(claim => claim.value))];
        const status = !claims.length ? "empty" : !asserted.length ? "unresolved" : asserted.some(claim => !claim.evidenceCurrent) ? "needs_review" : body?.cardinality === "single" && values.length > 1 ? "conflict" : "resolved";
        return { ...key, revision: body?.revision ?? 0, version, cardinality: body?.cardinality ?? null, status, claims, values: status === "resolved" ? values : [] };
    }
    history(access, request) {
        plainObject(request, ["scopeId", "subjectId", "predicate", "afterRevision", "limit"]);
        const key = this.#key(access, request, "read");
        const after = request.afterRevision ?? 0;
        const limit = request.limit ?? 20;
        integer(after);
        integer(limit, 1, 100);
        return this.#db.prepare("SELECT body FROM claim_revisions WHERE namespace_id=? AND scope_id=? AND subject_id=? AND predicate=? AND revision>? ORDER BY revision LIMIT ?").all(...key, after, limit).map(row => JSON.parse(String(row.body)));
    }
}
