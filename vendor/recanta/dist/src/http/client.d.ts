import type { MemoryAddRequest, MemoryAddResult, MemorySearchRequest, MemorySearchResult } from "../integrations/contracts.ts";
import type { ProcessingRun } from "../processing/contracts.ts";
import type { Evidence } from "../contracts.ts";
import type { HttpMemoryClientOptions, ProblemDetails } from "./contracts.ts";
import type { ManagedMemoryClient, MemoryListRequest, MemoryListResult, MemorySourceItem, MemoryHealth } from "../integrations/contracts.ts";
export declare class MemoryHttpError extends Error {
    readonly status: number;
    readonly problem: ProblemDetails;
    constructor(problem: ProblemDetails);
}
/** Remote implementation of the same MemoryClient contract. */
export declare class HttpMemoryClient implements ManagedMemoryClient {
    constructor(options: HttpMemoryClientOptions);
    add(request: MemoryAddRequest): Promise<MemoryAddResult>;
    search(request: MemorySearchRequest): Promise<MemorySearchResult>;
    get(evidenceId: string): Promise<Evidence>;
    processing(processingId: string): Promise<ProcessingRun>;
    retry(processingId: string): Promise<ProcessingRun>;
    list(request: MemoryListRequest): Promise<MemoryListResult>;
    inspect(id: string): Promise<MemorySourceItem>;
    health(scopes: readonly string[]): Promise<MemoryHealth>;
}
