export declare const MEMORY_HTTP_VERSION = "2026-09-18";
/** Stable OpenAPI 3.1 description for the current MemoryClient transport. */
export declare const MEMORY_OPENAPI: {
    readonly openapi: "3.1.0";
    readonly info: {
        readonly title: "Recanta Memory API";
        readonly version: "2026-09-18";
    };
    readonly servers: readonly [{
        readonly url: "/";
    }];
    readonly paths: {
        readonly "/v1/memories/list": {
            readonly post: {
                readonly operationId: "listMemorySources";
                readonly security: {
                    bearerAuth: never[];
                }[];
                readonly responses: {
                    readonly "200": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    readonly default: {
                        readonly $ref: "#/components/responses/Problem";
                    };
                };
            };
        };
        readonly "/v1/memories/inspect": {
            readonly post: {
                readonly operationId: "inspectMemorySource";
                readonly security: {
                    bearerAuth: never[];
                }[];
                readonly responses: {
                    readonly "200": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    readonly default: {
                        readonly $ref: "#/components/responses/Problem";
                    };
                };
            };
        };
        readonly "/v1/memories/health": {
            readonly post: {
                readonly operationId: "memoryHealth";
                readonly security: {
                    bearerAuth: never[];
                }[];
                readonly responses: {
                    readonly "200": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    readonly default: {
                        readonly $ref: "#/components/responses/Problem";
                    };
                };
            };
        };
        readonly "/v1/memories": {
            readonly post: {
                readonly operationId: "addMemory";
                readonly security: {
                    bearerAuth: never[];
                }[];
                readonly parameters: readonly [{
                    readonly name: "X-Request-Id";
                    readonly in: "header";
                    readonly required: false;
                    readonly schema: {
                        readonly type: "string";
                        readonly maxLength: 128;
                    };
                }, {
                    readonly name: "Idempotency-Key";
                    readonly in: "header";
                    readonly required: true;
                    readonly schema: {
                        readonly type: "string";
                        readonly minLength: 1;
                        readonly maxLength: 256;
                    };
                }];
                readonly requestBody: {
                    readonly required: true;
                    readonly content: {
                        readonly "application/json": {
                            readonly schema: {
                                readonly $ref: "#/components/schemas/MemoryAddBody";
                            };
                        };
                    };
                };
                readonly responses: {
                    readonly "200": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    readonly "201": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    readonly default: {
                        readonly $ref: "#/components/responses/Problem";
                    };
                };
            };
        };
        readonly "/v1/memories/search": {
            readonly post: {
                readonly operationId: "searchMemory";
                readonly security: {
                    bearerAuth: never[];
                }[];
                readonly parameters: readonly [{
                    readonly name: "X-Request-Id";
                    readonly in: "header";
                    readonly required: false;
                    readonly schema: {
                        readonly type: "string";
                        readonly maxLength: 128;
                    };
                }];
                readonly requestBody: {
                    readonly required: true;
                    readonly content: {
                        readonly "application/json": {
                            readonly schema: {
                                readonly $ref: "#/components/schemas/MemorySearchBody";
                            };
                        };
                    };
                };
                readonly responses: {
                    readonly "200": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    readonly default: {
                        readonly $ref: "#/components/responses/Problem";
                    };
                };
            };
        };
        readonly "/v1/evidence/{id}": {
            readonly get: {
                readonly operationId: "getEvidence";
                readonly security: {
                    bearerAuth: never[];
                }[];
                readonly parameters: readonly [{
                    readonly name: "X-Request-Id";
                    readonly in: "header";
                    readonly required: false;
                    readonly schema: {
                        readonly type: "string";
                        readonly maxLength: 128;
                    };
                }, {
                    readonly name: "id";
                    readonly in: "path";
                    readonly required: true;
                    readonly schema: {
                        readonly type: "string";
                        readonly minLength: 1;
                        readonly maxLength: 256;
                    };
                }];
                readonly responses: {
                    readonly "200": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    readonly default: {
                        readonly $ref: "#/components/responses/Problem";
                    };
                };
            };
        };
        readonly "/v1/processing/{id}": {
            readonly get: {
                readonly operationId: "getProcessing";
                readonly security: {
                    bearerAuth: never[];
                }[];
                readonly parameters: readonly [{
                    readonly name: "X-Request-Id";
                    readonly in: "header";
                    readonly required: false;
                    readonly schema: {
                        readonly type: "string";
                        readonly maxLength: 128;
                    };
                }, {
                    readonly name: "id";
                    readonly in: "path";
                    readonly required: true;
                    readonly schema: {
                        readonly type: "string";
                        readonly minLength: 1;
                        readonly maxLength: 256;
                    };
                }];
                readonly responses: {
                    readonly "200": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    readonly default: {
                        readonly $ref: "#/components/responses/Problem";
                    };
                };
            };
        };
        readonly "/v1/processing/{id}:retry": {
            readonly post: {
                readonly operationId: "retryProcessing";
                readonly security: {
                    bearerAuth: never[];
                }[];
                readonly parameters: readonly [{
                    readonly name: "X-Request-Id";
                    readonly in: "header";
                    readonly required: false;
                    readonly schema: {
                        readonly type: "string";
                        readonly maxLength: 128;
                    };
                }, {
                    readonly name: "id";
                    readonly in: "path";
                    readonly required: true;
                    readonly schema: {
                        readonly type: "string";
                        readonly minLength: 1;
                        readonly maxLength: 256;
                    };
                }];
                readonly responses: {
                    readonly "200": {
                        description: string;
                        content: {
                            "application/json": {
                                schema: {
                                    $ref: string;
                                };
                            };
                        };
                    };
                    readonly default: {
                        readonly $ref: "#/components/responses/Problem";
                    };
                };
            };
        };
    };
    readonly components: {
        readonly schemas: {
            readonly MemoryListResult: {
                readonly type: "object";
                readonly required: readonly ["items", "nextVersion", "version"];
                readonly additionalProperties: false;
                readonly properties: {
                    readonly items: {
                        readonly type: "array";
                        readonly items: {
                            readonly $ref: "#/components/schemas/MemorySourceItem";
                        };
                    };
                    readonly nextVersion: {
                        readonly type: readonly ["integer", "null"];
                    };
                    readonly version: {
                        readonly type: "integer";
                    };
                };
            };
            readonly MemorySourceItem: {
                readonly type: "object";
                readonly required: readonly ["evidence", "current", "runs", "facts"];
                readonly additionalProperties: true;
            };
            readonly MemoryHealth: {
                readonly type: "object";
                readonly required: readonly ["format", "namespaceId", "scopes", "ready", "counts", "capabilities"];
                readonly additionalProperties: true;
            };
            readonly MemoryAddBody: {
                readonly type: "object";
                readonly required: readonly ["scope", "content", "source"];
                readonly additionalProperties: false;
                readonly properties: {
                    readonly scope: {
                        readonly type: "string";
                    };
                    readonly content: {
                        readonly type: "string";
                    };
                    readonly source: {
                        readonly type: "object";
                    };
                    readonly sourceMetadata: {
                        readonly type: "object";
                        readonly additionalProperties: false;
                        readonly properties: {
                            readonly toolOutcome: {
                                readonly enum: readonly ["attempted", "succeeded", "failed", "unknown"];
                            };
                            readonly derivedFromEvidenceId: {
                                readonly type: "string";
                            };
                            readonly timezone: {
                                readonly type: "string";
                            };
                        };
                    };
                    readonly kind: {
                        readonly type: "string";
                    };
                    readonly subjects: {
                        readonly type: "array";
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                    readonly occurredAt: {
                        readonly type: "string";
                        readonly format: "date-time";
                    };
                    readonly processing: {
                        readonly type: "object";
                    };
                };
            };
            readonly MemorySearchBody: {
                readonly type: "object";
                readonly required: readonly ["query", "scopes"];
                readonly additionalProperties: false;
                readonly properties: {
                    readonly query: {
                        readonly type: "string";
                        readonly minLength: 1;
                        readonly maxLength: 4096;
                    };
                    readonly scopes: {
                        readonly type: "array";
                        readonly minItems: 1;
                        readonly maxItems: 64;
                        readonly uniqueItems: true;
                        readonly items: {
                            readonly type: "string";
                        };
                    };
                    readonly maxBytes: {
                        readonly type: "integer";
                        readonly minimum: 1;
                        readonly maximum: 262144;
                    };
                    readonly maxTokens: {
                        readonly type: "integer";
                        readonly minimum: 1;
                        readonly maximum: 131072;
                    };
                    readonly maxEstimatedTokens: {
                        readonly type: "integer";
                        readonly minimum: 1;
                        readonly maximum: 131072;
                    };
                    readonly limit: {
                        readonly type: "integer";
                        readonly minimum: 1;
                        readonly maximum: 50;
                    };
                    readonly consistency: {
                        readonly enum: readonly ["available", "strict"];
                    };
                    readonly minVersion: {
                        readonly type: "integer";
                        readonly minimum: 0;
                    };
                };
            };
            readonly MemoryAddResult: {
                readonly type: "object";
                readonly required: readonly ["id", "processingId", "version", "duplicate", "readiness"];
                readonly additionalProperties: false;
                readonly properties: {
                    readonly id: {
                        readonly type: "string";
                    };
                    readonly processingId: {
                        readonly type: "string";
                    };
                    readonly version: {
                        readonly type: "integer";
                    };
                    readonly duplicate: {
                        readonly type: "boolean";
                    };
                    readonly readiness: {
                        readonly type: "object";
                    };
                };
            };
            readonly MemorySearchResult: {
                readonly type: "object";
                readonly required: readonly ["format", "context", "contextText", "bytes", "version", "snapshot"];
                readonly additionalProperties: false;
                readonly properties: {
                    readonly format: {
                        readonly const: "recanta-memory-search-v1";
                    };
                    readonly context: {
                        readonly type: "object";
                    };
                    readonly contextText: {
                        readonly type: "string";
                    };
                    readonly bytes: {
                        readonly type: "integer";
                    };
                    readonly version: {
                        readonly type: "integer";
                    };
                    readonly snapshot: {
                        readonly type: "object";
                    };
                };
            };
            readonly Evidence: {
                readonly type: "object";
                readonly required: readonly ["id", "namespaceId", "scopeId", "sourceId", "sourceVersion", "kind", "content", "contentHash", "recordedAt", "version"];
                readonly additionalProperties: true;
            };
            readonly ProcessingRun: {
                readonly type: "object";
                readonly required: readonly ["id", "namespaceId", "scopeId", "evidenceId", "status", "attempts", "maxAttempts", "decisions"];
                readonly additionalProperties: true;
            };
            readonly Problem: {
                readonly type: "object";
                readonly required: readonly ["type", "title", "status", "detail", "instance", "code", "requestId"];
                readonly additionalProperties: false;
                readonly properties: {
                    readonly type: {
                        readonly type: "string";
                        readonly format: "uri-reference";
                    };
                    readonly title: {
                        readonly type: "string";
                    };
                    readonly status: {
                        readonly type: "integer";
                    };
                    readonly detail: {
                        readonly type: "string";
                    };
                    readonly instance: {
                        readonly type: "string";
                        readonly format: "uri-reference";
                    };
                    readonly code: {
                        readonly type: "string";
                    };
                    readonly requestId: {
                        readonly type: "string";
                    };
                };
            };
        };
        readonly responses: {
            readonly Problem: {
                readonly description: "RFC 9457 problem details";
                readonly content: {
                    readonly "application/problem+json": {
                        readonly schema: {
                            readonly $ref: "#/components/schemas/Problem";
                        };
                    };
                };
            };
        };
        readonly securitySchemes: {
            readonly bearerAuth: {
                readonly type: "http";
                readonly scheme: "bearer";
            };
        };
    };
};
