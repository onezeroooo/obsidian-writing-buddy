import { decodeUtf8 } from "../runtime.js";
import { RecantaError } from "../errors.js";
import { id, integer, plainObject } from "../validation.js";
const knownCodes = new Set(["INVALID_INPUT", "FORBIDDEN", "NOT_FOUND", "IDEMPOTENCY_CONFLICT", "VERSION_CONFLICT", "UNSUPPORTED_SCHEMA", "FOREIGN_DATABASE", "CLOSED", "INSUFFICIENT_BUDGET", "NOT_READY", "STALE_SOURCE", "INDEX_VERSION_MISMATCH"]);
export class MemoryHttpError extends Error {
    status;
    problem;
    constructor(problem) { super(problem.detail); this.name = "MemoryHttpError"; this.status = problem.status; this.problem = problem; }
}
/** Remote implementation of the same MemoryClient contract. */
export class HttpMemoryClient {
    #options;
    #base;
    constructor(options) {
        plainObject(options, ["baseUrl", "authorization", "fetch", "timeoutMs", "maxResponseBytes", "traceparent", "tracestate"]);
        this.#base = new URL(options.baseUrl);
        if (!["http:", "https:"].includes(this.#base.protocol) || this.#base.username || this.#base.password || this.#base.search || this.#base.hash || (this.#base.pathname !== "/" && this.#base.pathname !== ""))
            throw new TypeError("baseUrl must be an HTTP(S) origin without credentials, path, query or hash.");
        integer(options.timeoutMs ?? 30000, 1, 300000);
        integer(options.maxResponseBytes ?? 2_097_152, 1024, 16_777_216);
        this.#options = { ...options };
    }
    async #authorization() { const value = typeof this.#options.authorization === "function" ? await this.#options.authorization() : this.#options.authorization; return value; }
    async #request(path, init = {}) {
        const headers = new Headers(init.headers);
        const authorization = await this.#authorization();
        if (authorization)
            headers.set("Authorization", authorization);
        const traceparent = this.#options.traceparent?.();
        if (traceparent)
            headers.set("traceparent", traceparent);
        const tracestate = this.#options.tracestate?.();
        if (tracestate)
            headers.set("tracestate", tracestate);
        let response;
        try {
            response = await (this.#options.fetch ?? fetch)(new URL(path, this.#base), { ...init, headers, redirect: "error", signal: init.signal ?? AbortSignal.timeout(this.#options.timeoutMs ?? 30000) });
        }
        catch {
            throw new MemoryHttpError({ type: "about:blank", title: "Service unavailable", status: 503, detail: "Memory service request failed.", instance: path, code: "TRANSPORT_UNAVAILABLE", requestId: "unavailable" });
        }
        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
        if (contentType !== "application/json" && contentType !== "application/problem+json")
            throw new MemoryHttpError({ type: "about:blank", title: "Bad gateway", status: 502, detail: "Memory service returned an unsupported content type.", instance: path, code: "INVALID_RESPONSE", requestId: response.headers.get("x-request-id") ?? "unknown" });
        if (!response.body)
            throw new MemoryHttpError({ type: "about:blank", title: "Bad gateway", status: 502, detail: "Memory service returned no body.", instance: path, code: "INVALID_RESPONSE", requestId: response.headers.get("x-request-id") ?? "unknown" });
        const reader = response.body.getReader();
        const chunks = [];
        let bytes = 0;
        try {
            while (true) {
                const part = await reader.read();
                if (part.done)
                    break;
                bytes += part.value.byteLength;
                if (bytes > (this.#options.maxResponseBytes ?? 2_097_152))
                    throw new MemoryHttpError({ type: "about:blank", title: "Bad gateway", status: 502, detail: "Memory service response exceeded the configured limit.", instance: path, code: "INVALID_RESPONSE", requestId: response.headers.get("x-request-id") ?? "unknown" });
                chunks.push(part.value);
            }
        }
        finally {
            await reader.cancel();
        }
        let data;
        try {
            data = JSON.parse(decodeUtf8(chunks));
        }
        catch {
            throw new MemoryHttpError({ type: "about:blank", title: "Bad gateway", status: 502, detail: "Memory service returned invalid JSON.", instance: path, code: "INVALID_RESPONSE", requestId: response.headers.get("x-request-id") ?? "unknown" });
        }
        if (!response.ok) {
            const p = data;
            if (p && typeof p === "object" && typeof p.code === "string" && knownCodes.has(p.code))
                throw new RecantaError(p.code, p.detail);
            throw new MemoryHttpError(p);
        }
        return data;
    }
    async add(request) {
        const { idempotencyKey, ...body } = request;
        id(idempotencyKey);
        return this.#request("/v1/memories", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey }, body: JSON.stringify(body) });
    }
    search(request) { return this.#request("/v1/memories/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) }); }
    get(evidenceId) { id(evidenceId); return this.#request("/v1/evidence/" + encodeURIComponent(evidenceId)); }
    processing(processingId) { id(processingId); return this.#request("/v1/processing/" + encodeURIComponent(processingId)); }
    retry(processingId) { id(processingId); return this.#request("/v1/processing/" + encodeURIComponent(processingId) + ":retry", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); }
    list(request) { return this.#request("/v1/memories/list", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) }); }
    inspect(id) { return this.#request("/v1/memories/inspect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); }
    health(scopes) { return this.#request("/v1/memories/health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scopes }) }); }
}
