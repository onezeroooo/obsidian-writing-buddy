import type { IncomingHttpHeaders } from "node:http";
import type { MemoryClient } from "../integrations/contracts.ts";
export interface HttpRequestContext {
    authorization: string | null;
    traceparent: string | null;
    tracestate: string | null;
    requestId: string;
    remoteAddress: string | null;
    method: string;
    path: string;
    headers: IncomingHttpHeaders;
}
/** Authentication and authorization remain host responsibilities. */
/** Return null when the request is not authenticated. */
export type MemoryClientResolver = (context: HttpRequestContext) => MemoryClient | null | Promise<MemoryClient | null>;
export interface MemoryHttpServerOptions {
    resolveClient: MemoryClientResolver;
    host?: string;
    port?: number;
    maxBodyBytes?: number;
    requestTimeoutMs?: number;
}
export interface MemoryHttpServer {
    readonly url: string;
    close(): Promise<void>;
}
export interface HttpMemoryClientOptions {
    baseUrl: string;
    authorization?: string | (() => string | Promise<string>);
    fetch?: typeof fetch;
    timeoutMs?: number;
    maxResponseBytes?: number;
    traceparent?: () => string | undefined;
    tracestate?: () => string | undefined;
}
export interface ProblemDetails {
    type: string;
    title: string;
    status: number;
    detail: string;
    instance: string;
    code: string;
    requestId: string;
}
