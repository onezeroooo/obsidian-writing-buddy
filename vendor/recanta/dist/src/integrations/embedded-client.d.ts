import type { Access } from "../contracts.ts";
import type { SqliteRecanta } from "../recanta.ts";
import type { MemoryListRequest, MemoryListResult, MemorySourceItem, MemoryHealth, ManagedMemoryClient } from "./contracts.ts";
import type { MemoryAddRequest, MemoryAddResult, MemorySearchRequest, MemorySearchResult, TrustedIntegrationPrincipal, TrustedSourceProvenance } from "./contracts.ts";
/** Promise-based facade keeps embedded and remote transports behaviorally aligned. */
export declare class EmbeddedMemoryClient implements ManagedMemoryClient {
    #private;
    constructor(engine: SqliteRecanta, access: Access, principal: TrustedIntegrationPrincipal);
    /** Normal path: untrusted request data; source provenance and authority are the bound principal default. */
    add(request: MemoryAddRequest): Promise<MemoryAddResult>;
    /**
     * Trusted host-only path: the trusted integration supplies per-write source provenance while
     * authentication and scopes stay client-bound. Provenance must be permitted by principal policy;
     * reconciliation authority is granted only when the principal explicitly allows it.
     */
    addTrusted(source: TrustedSourceProvenance, request: MemoryAddRequest): Promise<MemoryAddResult>;
    search(request: MemorySearchRequest): Promise<MemorySearchResult>;
    get(evidenceId: string): Promise<import("../contracts.ts").Evidence>;
    processing(processingId: string): Promise<import("../processing/contracts.ts").ProcessingRun>;
    retry(processingId: string): Promise<import("../processing/contracts.ts").ProcessingRun>;
    inspect(evidenceId: string): Promise<MemorySourceItem>;
    list(request: MemoryListRequest): Promise<MemoryListResult>;
    health(selected: readonly string[]): Promise<MemoryHealth>;
}
