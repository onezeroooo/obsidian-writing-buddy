import { createServer } from "node:http";
import { randomHex, randomId } from "../runtime.js";
import { check, RecantaError } from "../errors.js";
import { integer, plainObject, scopes } from "../validation.js";
import { metadata, text } from "../processing/validation.js";
import { INSPECTOR_PAGE } from "./page.js";
/** Explicitly started local UI with fixed trusted access and source identity. */
export async function startInspector(store, options) {
    plainObject(options, ["access", "scopes", "port", "correctionMetadata"]);
    const selected = scopes(options.access, options.scopes, "read");
    integer(options.port ?? 0, 0, 65535);
    const access = { namespaceId: options.access.namespaceId, readScopes: [...selected], writeScopes: options.access.writeScopes.filter(s => selected.includes(s)) };
    const correction = options.correctionMetadata ? metadata(options.correctionMetadata) : null;
    const token = randomHex(32);
    const nonce = randomHex(24);
    let origin = "";
    const server = createServer(async (req, res) => {
        const fail = (status, code, error) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify({ code, error })); };
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
        try {
            check(req.headers.host === new URL(origin).host, "FORBIDDEN", "Invalid local host.");
            if (req.method === "GET" && req.url === "/") {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(INSPECTOR_PAGE.replace("__TOKEN__", JSON.stringify(token)).replace("__NONCE__", nonce));
                return;
            }
            check(req.method === "POST" && req.url?.startsWith("/api/") && req.headers.authorization === "Bearer " + token, "FORBIDDEN", "Inspector access denied.");
            check(!req.headers.origin || req.headers.origin === origin, "FORBIDDEN", "Cross-origin requests are not allowed.");
            check(req.headers["content-type"] === "application/json", "INVALID_INPUT", "Expected JSON.");
            const parts = [];
            let bytes = 0;
            for await (const part of req) {
                const data = Buffer.from(part);
                bytes += data.byteLength;
                check(bytes <= 65536, "INVALID_INPUT", "Inspector request exceeds 64 KiB.");
                parts.push(data);
            }
            const payload = JSON.parse(Buffer.concat(parts).toString("utf8"));
            let result;
            switch (req.url) {
                case "/api/config":
                    result = { scopes: selected, canWrite: !!correction && access.writeScopes.length > 0, actorId: correction?.actorId ?? null };
                    break;
                case "/api/inspect":
                    result = store.inspectContext(access, payload);
                    break;
                case "/api/evidence":
                    plainObject(payload, ["evidenceId"]);
                    result = store.inspectEvidence(access, payload.evidenceId);
                    break;
                case "/api/episodes":
                    result = store.searchEpisodes(access, payload);
                    break;
                case "/api/fresh":
                    plainObject(payload, ["snapshot"]);
                    result = { fresh: store.isContextFresh(access, payload.snapshot) };
                    break;
                case "/api/retry":
                    plainObject(payload, ["processingId"]);
                    check(correction, "FORBIDDEN", "Inspector is read only.");
                    result = await store.retryProcessing(access, payload.processingId);
                    break;
                case "/api/correct": {
                    plainObject(payload, ["scopeId", "content", "snapshot"]);
                    check(correction, "FORBIDDEN", "Inspector is read only.");
                    scopes(access, [payload.scopeId], "write");
                    text(payload.content, 32768);
                    check(Object.hasOwn(payload.snapshot?.generations ?? {}, payload.scopeId) && store.isContextFresh(access, payload.snapshot), "VERSION_CONFLICT", "Context changed; inspect again before correcting.");
                    const id = randomId();
                    result = await store.retain(access, { streamId: "inspector-corrections", eventId: id, sourceId: id, sourceVersion: 1, scopeId: payload.scopeId, content: payload.content, kind: "correction", occurredAt: new Date().toISOString(), metadata: correction }, { expectedSnapshot: payload.snapshot });
                    break;
                }
                default:
                    fail(404, "NOT_FOUND", "Unknown inspector route.");
                    return;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
        }
        catch (error) {
            const code = error instanceof RecantaError ? error.code : "INVALID_INPUT";
            const status = code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" ? 404 : ["VERSION_CONFLICT", "NOT_READY"].includes(code) ? 409 : 400;
            fail(status, code, error instanceof RecantaError ? error.message : "Invalid inspector request.");
        }
    });
    server.requestTimeout = 30000;
    server.headersTimeout = 10000;
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(options.port ?? 0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
    const address = server.address();
    check(address && typeof address !== "string", "NOT_READY", "Inspector did not bind a local port.");
    origin = "http://127.0.0.1:" + address.port;
    return { url: origin, close: () => new Promise((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); }) };
}
