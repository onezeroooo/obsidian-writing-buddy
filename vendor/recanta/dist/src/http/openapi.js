export const MEMORY_HTTP_VERSION = "2026-09-18";
const security = [{ bearerAuth: [] }];
const requestId = { name: "X-Request-Id", in: "header", required: false, schema: { type: "string", maxLength: 128 } };
const idParameter = { name: "id", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 256 } };
const response = (description, schema) => ({ description, content: { "application/json": { schema: { $ref: schema } } } });
/** Stable OpenAPI 3.1 description for the current MemoryClient transport. */
export const MEMORY_OPENAPI = {
    openapi: "3.1.0",
    info: { title: "Recanta Memory API", version: MEMORY_HTTP_VERSION },
    servers: [{ url: "/" }],
    paths: {
        "/v1/memories/list": { post: { operationId: "listMemorySources", security, responses: { "200": response("Bounded source inventory", "#/components/schemas/MemoryListResult"), default: { $ref: "#/components/responses/Problem" } } } },
        "/v1/memories/inspect": { post: { operationId: "inspectMemorySource", security, responses: { "200": response("Evidence, processing and current facts", "#/components/schemas/MemorySourceItem"), default: { $ref: "#/components/responses/Problem" } } } },
        "/v1/memories/health": { post: { operationId: "memoryHealth", security, responses: { "200": response("Authenticated scoped readiness", "#/components/schemas/MemoryHealth"), default: { $ref: "#/components/responses/Problem" } } } },
        "/v1/memories": { post: { operationId: "addMemory", security, parameters: [requestId, { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 1, maxLength: 256 } }], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/MemoryAddBody" } } } }, responses: { "200": response("Existing idempotent result", "#/components/schemas/MemoryAddResult"), "201": response("Memory accepted", "#/components/schemas/MemoryAddResult"), default: { $ref: "#/components/responses/Problem" } } } },
        "/v1/memories/search": { post: { operationId: "searchMemory", security, parameters: [requestId], requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/MemorySearchBody" } } } }, responses: { "200": response("Bounded memory context", "#/components/schemas/MemorySearchResult"), default: { $ref: "#/components/responses/Problem" } } } },
        "/v1/evidence/{id}": { get: { operationId: "getEvidence", security, parameters: [requestId, idParameter], responses: { "200": response("Evidence", "#/components/schemas/Evidence"), default: { $ref: "#/components/responses/Problem" } } } },
        "/v1/processing/{id}": { get: { operationId: "getProcessing", security, parameters: [requestId, idParameter], responses: { "200": response("Processing run", "#/components/schemas/ProcessingRun"), default: { $ref: "#/components/responses/Problem" } } } },
        "/v1/processing/{id}:retry": { post: { operationId: "retryProcessing", security, parameters: [requestId, idParameter], responses: { "200": response("Processing run", "#/components/schemas/ProcessingRun"), default: { $ref: "#/components/responses/Problem" } } } },
    },
    components: {
        schemas: {
            MemoryListResult: { type: "object", required: ["items", "nextVersion", "version"], additionalProperties: false, properties: { items: { type: "array", items: { $ref: "#/components/schemas/MemorySourceItem" } }, nextVersion: { type: ["integer", "null"] }, version: { type: "integer" } } },
            MemorySourceItem: { type: "object", required: ["evidence", "current", "runs", "facts"], additionalProperties: true },
            MemoryHealth: { type: "object", required: ["format", "namespaceId", "scopes", "ready", "counts", "capabilities"], additionalProperties: true },
            MemoryAddBody: { type: "object", required: ["scope", "content", "source"], additionalProperties: false, properties: { scope: { type: "string" }, content: { type: "string" }, source: { type: "object" }, sourceMetadata: { type: "object", additionalProperties: false, properties: { toolOutcome: { enum: ["attempted", "succeeded", "failed", "unknown"] }, derivedFromEvidenceId: { type: "string" }, timezone: { type: "string" } } }, kind: { type: "string" }, subjects: { type: "array", items: { type: "string" } }, occurredAt: { type: "string", format: "date-time" }, processing: { type: "object" } } },
            MemorySearchBody: { type: "object", required: ["query", "scopes"], additionalProperties: false, properties: { query: { type: "string", minLength: 1, maxLength: 4096 }, scopes: { type: "array", minItems: 1, maxItems: 64, uniqueItems: true, items: { type: "string" } }, maxBytes: { type: "integer", minimum: 1, maximum: 262144 }, maxTokens: { type: "integer", minimum: 1, maximum: 131072 }, maxEstimatedTokens: { type: "integer", minimum: 1, maximum: 131072 }, limit: { type: "integer", minimum: 1, maximum: 50 }, consistency: { enum: ["available", "strict"] }, minVersion: { type: "integer", minimum: 0 } } },
            MemoryAddResult: { type: "object", required: ["id", "processingId", "version", "duplicate", "readiness"], additionalProperties: false, properties: { id: { type: "string" }, processingId: { type: "string" }, version: { type: "integer" }, duplicate: { type: "boolean" }, readiness: { type: "object" } } },
            MemorySearchResult: { type: "object", required: ["format", "context", "contextText", "bytes", "version", "snapshot"], additionalProperties: false, properties: { format: { const: "recanta-memory-search-v1" }, context: { type: "object" }, contextText: { type: "string" }, bytes: { type: "integer" }, version: { type: "integer" }, snapshot: { type: "object" } } },
            Evidence: { type: "object", required: ["id", "namespaceId", "scopeId", "sourceId", "sourceVersion", "kind", "content", "contentHash", "recordedAt", "version"], additionalProperties: true },
            ProcessingRun: { type: "object", required: ["id", "namespaceId", "scopeId", "evidenceId", "status", "attempts", "maxAttempts", "decisions"], additionalProperties: true },
            Problem: { type: "object", required: ["type", "title", "status", "detail", "instance", "code", "requestId"], additionalProperties: false, properties: { type: { type: "string", format: "uri-reference" }, title: { type: "string" }, status: { type: "integer" }, detail: { type: "string" }, instance: { type: "string", format: "uri-reference" }, code: { type: "string" }, requestId: { type: "string" } } },
        },
        responses: { Problem: { description: "RFC 9457 problem details", content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } } },
        securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    },
};
