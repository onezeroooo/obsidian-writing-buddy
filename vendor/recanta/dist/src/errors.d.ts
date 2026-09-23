export type ErrorCode = "INVALID_INPUT" | "FORBIDDEN" | "NOT_FOUND" | "IDEMPOTENCY_CONFLICT" | "VERSION_CONFLICT" | "UNSUPPORTED_SCHEMA" | "FOREIGN_DATABASE" | "CLOSED" | "INSUFFICIENT_BUDGET" | "NOT_READY" | "STALE_SOURCE" | "INDEX_VERSION_MISMATCH" | "UNSUPPORTED_RUNTIME" | "INCOMPATIBLE_ARTIFACT";
export declare class RecantaError extends Error {
    readonly code: ErrorCode;
    constructor(code: ErrorCode, message: string);
}
export declare function check(condition: unknown, code: ErrorCode, message: string): asserts condition;
