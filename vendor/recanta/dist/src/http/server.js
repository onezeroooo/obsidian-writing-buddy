import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { check } from "../errors.js";
import { id, integer, plainObject } from "../validation.js";
import { MEMORY_HTTP_VERSION, MEMORY_OPENAPI } from "./openapi.js";
import { HttpAdapterError, problem } from "./problem.js";
const traceparentPattern = /^00-[a-f0-9]{32}-[a-f0-9]{16}-[a-f0-9]{2}$/u;
const json = (res, status, body, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers }); res.end(JSON.stringify(body)); };
async function body(req, limit) {
    const contentType = req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
    if (contentType !== "application/json")
        throw new HttpAdapterError(415, "UNSUPPORTED_MEDIA_TYPE", "Expected application/json.");
    const parts = [];
    let size = 0;
    for await (const chunk of req) {
        const part = Buffer.from(chunk);
        size += part.length;
        if (size > limit)
            throw new HttpAdapterError(413, "CONTENT_TOO_LARGE", "Request body exceeds the configured limit.");
        parts.push(part);
    }
    try {
        return JSON.parse(Buffer.concat(parts).toString("utf8"));
    }
    catch {
        throw new HttpAdapterError(400, "INVALID_JSON", "Request body is not valid JSON.");
    }
}
const decodeId = (value) => { let decoded; try {
    decoded = decodeURIComponent(value);
}
catch {
    throw new HttpAdapterError(400, "INVALID_PATH", "Invalid percent-encoded path.");
} id(decoded); return decoded; };
/** Explicit server adapter. It never starts on import and owns no memory semantics. */
export async function startMemoryHttpServer(options) {
    plainObject(options, ["resolveClient", "host", "port", "maxBodyBytes", "requestTimeoutMs"]);
    check(typeof options.resolveClient === "function", "INVALID_INPUT", "resolveClient is required.");
    const host = options.host ?? "127.0.0.1";
    id(host);
    const port = options.port ?? 0;
    integer(port, 0, 65535);
    const maxBodyBytes = options.maxBodyBytes ?? 1_114_112;
    integer(maxBodyBytes, 1024, 2_097_152);
    const timeout = options.requestTimeoutMs ?? 30000;
    integer(timeout, 1, 300000);
    let origin = "";
    const server = createServer(async (req, res) => {
        const requestId = typeof req.headers["x-request-id"] === "string" && /^[A-Za-z0-9._-]{1,128}$/u.test(req.headers["x-request-id"]) ? req.headers["x-request-id"] : randomUUID();
        const responseHeaders = { "X-Request-Id": requestId, "Recanta-Api-Version": MEMORY_HTTP_VERSION };
        const traceparent = typeof req.headers.traceparent === "string" && traceparentPattern.test(req.headers.traceparent) ? req.headers.traceparent : null;
        if (traceparent)
            responseHeaders.traceparent = traceparent;
        try {
            if (req.url === "/openapi.json") {
                if (req.method !== "GET")
                    throw new HttpAdapterError(405, "METHOD_NOT_ALLOWED", "Use GET for this resource.");
                json(res, 200, MEMORY_OPENAPI, responseHeaders);
                return;
            }
            const url = new URL(req.url ?? "/", origin);
            const path = url.pathname;
            if (url.search)
                throw new HttpAdapterError(400, "INVALID_QUERY", "Query parameters are not supported on this route.");
            const context = { authorization: typeof req.headers.authorization === "string" ? req.headers.authorization : null, traceparent, tracestate: typeof req.headers.tracestate === "string" ? req.headers.tracestate : null, requestId, remoteAddress: req.socket.remoteAddress ?? null, method: req.method ?? "", path, headers: req.headers };
            const client = await options.resolveClient(context);
            if (!client)
                throw new HttpAdapterError(401, "UNAUTHORIZED", "Authentication required.");
            let result;
            let status = 200;
            if (path === "/v1/memories") {
                if (req.method !== "POST")
                    throw new HttpAdapterError(405, "METHOD_NOT_ALLOWED", "Use POST for this resource.");
                const payload = await body(req, maxBodyBytes);
                plainObject(payload, ["scope", "content", "source", "kind", "subjects", "occurredAt", "sourceMetadata", "processing"]);
                if (payload.sourceMetadata !== undefined)
                    plainObject(payload.sourceMetadata, ["toolOutcome", "derivedFromEvidenceId", "timezone"]);
                const header = req.headers["idempotency-key"];
                if (typeof header !== "string")
                    throw new HttpAdapterError(400, "MISSING_IDEMPOTENCY_KEY", "Idempotency-Key header is required.");
                id(header);
                check(!Object.hasOwn(payload, "idempotencyKey"), "INVALID_INPUT", "idempotencyKey must be supplied only by the Idempotency-Key header.");
                result = await client.add({ ...payload, idempotencyKey: header });
                status = result && typeof result === "object" && "duplicate" in result && result.duplicate ? 200 : 201;
            }
            else if (path === "/v1/memories/search") {
                if (req.method !== "POST")
                    throw new HttpAdapterError(405, "METHOD_NOT_ALLOWED", "Use POST for this resource.");
                result = await client.search(await body(req, maxBodyBytes));
            }
            else if (path === "/v1/memories/list" || path === "/v1/memories/health" || path === "/v1/memories/inspect") {
                if (req.method !== "POST")
                    throw new HttpAdapterError(405, "METHOD_NOT_ALLOWED", "Use POST for this resource.");
                const managed = client;
                const payload = await body(req, maxBodyBytes);
                if (path.endsWith("/list") && managed.list)
                    result = await managed.list(payload);
                else if (path.endsWith("/health") && managed.health) {
                    plainObject(payload, ["scopes"]);
                    result = await managed.health(payload.scopes);
                }
                else if (path.endsWith("/inspect") && managed.inspect) {
                    plainObject(payload, ["id"]);
                    id(payload.id);
                    result = await managed.inspect(payload.id);
                }
                else
                    throw new HttpAdapterError(501, "UNSUPPORTED_EXTENSION", "Memory management extension is unavailable.");
            }
            else {
                const retry = /^\/v1\/processing\/([^/]+):retry$/u.exec(path);
                const processing = /^\/v1\/processing\/([^/]+)$/u.exec(path);
                const evidence = /^\/v1\/evidence\/([^/]+)$/u.exec(path);
                if (evidence) {
                    if (req.method !== "GET")
                        throw new HttpAdapterError(405, "METHOD_NOT_ALLOWED", "Use GET for this resource.");
                    result = await client.get(decodeId(evidence[1]));
                }
                else if (retry) {
                    if (req.method !== "POST")
                        throw new HttpAdapterError(405, "METHOD_NOT_ALLOWED", "Use POST for retry.");
                    result = await client.retry(decodeId(retry[1]));
                }
                else if (processing) {
                    if (req.method !== "GET")
                        throw new HttpAdapterError(405, "METHOD_NOT_ALLOWED", "Use GET for status.");
                    result = await client.processing(decodeId(processing[1]));
                }
                else
                    throw new HttpAdapterError(404, "NOT_FOUND", "HTTP memory resource was not found.");
            }
            json(res, status, result, responseHeaders);
        }
        catch (error) {
            const details = problem(error, req.url ?? "/", requestId);
            json(res, details.status, details, { ...responseHeaders, "Content-Type": "application/problem+json" });
        }
    });
    server.requestTimeout = timeout;
    server.headersTimeout = Math.min(timeout, 10000);
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, () => { server.off("error", reject); resolve(); }); });
    const address = server.address();
    check(address && typeof address !== "string", "NOT_READY", "HTTP adapter did not bind a TCP port.");
    origin = "http://" + (address.family === "IPv6" ? "[" + address.address + "]" : address.address) + ":" + address.port;
    return { url: origin, close: () => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }) };
}
