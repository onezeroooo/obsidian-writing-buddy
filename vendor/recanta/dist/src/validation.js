import { sha256Hex } from "./hash.js";
import { utf8Length } from "./runtime.js";
import { check } from "./errors.js";
export const MAX_CONTENT_BYTES = 1_048_576;
const kinds = new Set(["message", "observation", "action_result", "state_change", "document_revision", "correction"]);
export function id(value) {
    check(typeof value === "string" && value.length > 0 && value.length <= 256 && value.isWellFormed() && value.trim() === value && !/[\u0000-\u001f]/u.test(value), "INVALID_INPUT", "Identifiers must be well-formed nonempty strings of at most 256 characters without surrounding whitespace or controls.");
}
export function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
    check(typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max, "INVALID_INPUT", "Expected a bounded safe integer.");
}
export function plainObject(value, fields) {
    check(value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype, "INVALID_INPUT", "Expected a plain object.");
    if (fields)
        check(Object.keys(value).every(key => fields.includes(key)), "INVALID_INPUT", "Unknown object field.");
}
export function ids(value, allowEmpty = false) {
    check(Array.isArray(value) && value.length <= 64 && (allowEmpty || value.length > 0), "INVALID_INPUT", "Expected a bounded identifier array.");
    for (const item of value)
        id(item);
    check(new Set(value).size === value.length, "INVALID_INPUT", "Duplicate identifiers are not allowed.");
}
export function validateAccess(access) {
    plainObject(access);
    id(access.namespaceId);
    ids(access.readScopes, true);
    ids(access.writeScopes, true);
}
export function scopes(access, requested, mode) {
    validateAccess(access);
    ids(requested);
    const allowed = mode === "read" ? access.readScopes : access.writeScopes;
    check(requested.every(scope => allowed.includes(scope)), "FORBIDDEN", "Scope access denied.");
    return [...requested].sort();
}
export function canonicalEvent(event) {
    plainObject(event);
    const fields = new Set(["streamId", "eventId", "scopeId", "sourceId", "sourceVersion", "subjectIds", "kind", "content", "occurredAt"]);
    check(Object.keys(event).every(key => fields.has(key)), "INVALID_INPUT", "Unknown event field.");
    for (const value of [event.streamId, event.eventId, event.scopeId, event.sourceId])
        id(value);
    integer(event.sourceVersion, 1);
    ids(event.subjectIds, true);
    check(kinds.has(event.kind), "INVALID_INPUT", "Unsupported event kind.");
    check(typeof event.content === "string" && event.content.trim().length > 0 && utf8Length(event.content) <= MAX_CONTENT_BYTES && !event.content.includes("\0") && event.content.isWellFormed(), "INVALID_INPUT", "Content must be nonempty, well-formed UTF-8 text within the size limit.");
    if (event.occurredAt !== undefined) {
        check(typeof event.occurredAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.occurredAt) && Number.isFinite(Date.parse(event.occurredAt)) && new Date(event.occurredAt).toISOString() === event.occurredAt, "INVALID_INPUT", "occurredAt must be a canonical UTC ISO timestamp with milliseconds.");
    }
    return {
        streamId: event.streamId, eventId: event.eventId,
        scopeId: event.scopeId, sourceId: event.sourceId, sourceVersion: event.sourceVersion,
        subjectIds: [...event.subjectIds].sort(), kind: event.kind, content: event.content,
        ...(event.occurredAt === undefined ? {} : { occurredAt: event.occurredAt }),
    };
}
export function feed(access, request) {
    plainObject(request);
    const selected = scopes(access, request.scopes, "read");
    const after = request.afterVersion ?? 0;
    const limit = request.limit ?? 100;
    integer(after);
    integer(limit, 1, 500);
    return { selected, after, limit };
}
export function hash(value) {
    return sha256Hex(value);
}
