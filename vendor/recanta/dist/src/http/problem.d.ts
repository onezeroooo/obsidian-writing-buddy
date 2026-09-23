import type { ProblemDetails } from "./contracts.ts";
export declare class HttpAdapterError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string);
}
export declare function problem(error: unknown, instance: string, requestId?: string): ProblemDetails;
