import { randomId } from "../runtime.js";
import { RecantaError } from "../errors.js";
const statusByCode = {
    INVALID_INPUT: 400, FORBIDDEN: 403, NOT_FOUND: 404,
    IDEMPOTENCY_CONFLICT: 409, VERSION_CONFLICT: 409, NOT_READY: 409,
    STALE_SOURCE: 409, INSUFFICIENT_BUDGET: 422, UNSUPPORTED_SCHEMA: 503,
    FOREIGN_DATABASE: 503, CLOSED: 503, INDEX_VERSION_MISMATCH: 503,
};
const titleByStatus = { 400: "Invalid request", 401: "Unauthorized", 403: "Forbidden", 404: "Not found", 405: "Method not allowed", 409: "Conflict", 413: "Content too large", 415: "Unsupported media type", 422: "Unprocessable content", 429: "Too many requests", 500: "Internal server error", 502: "Bad gateway", 503: "Service unavailable" };
export class HttpAdapterError extends Error {
    status;
    code;
    constructor(status, code, message) { super(message); this.name = "HttpAdapterError"; this.status = status; this.code = code; }
}
export function problem(error, instance, requestId = randomId()) {
    const status = error instanceof HttpAdapterError ? error.status : error instanceof RecantaError ? statusByCode[error.code] ?? 500 : 500;
    const code = error instanceof HttpAdapterError ? error.code : error instanceof RecantaError ? error.code : "INTERNAL_ERROR";
    const detail = error instanceof HttpAdapterError || error instanceof RecantaError ? error.message : "The server could not complete the request.";
    return { type: "about:blank", title: titleByStatus[status] ?? "Request failed", status, detail, instance, code, requestId };
}
