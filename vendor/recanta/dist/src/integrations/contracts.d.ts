import type { Evidence } from "../contracts.ts";
import type { RecallBody } from "../context/recall-contracts.ts";
import type { SearchSnapshot } from "../retrieval/contracts.ts";
import type { ProcessingRun, ProcessingState, SourceMetadata } from "../processing/contracts.ts";
import type { EvidenceInspection } from "../inspector/contracts.ts";
import type { FactState } from "../memory/contracts.ts";
export interface MemorySourceItem extends EvidenceInspection {
    facts: Array<Omit<FactState, "snapshot">>;
}
export interface MemoryListRequest {
    scopes: readonly string[];
    afterVersion?: number;
    limit?: number;
    history?: boolean;
}
export interface MemoryListResult {
    items: MemorySourceItem[];
    nextVersion: number | null;
    version: number;
}
export interface MemoryHealth {
    format: "recanta-health-v1";
    namespaceId: string;
    scopes: readonly string[];
    version: number;
    counts: Record<string, number>;
    ready: boolean;
    capabilities: string[];
}
/** Optional versioned management extension; base MemoryClient callers remain compatible. */
export interface ManagedMemoryClient extends MemoryClient {
    list(request: MemoryListRequest): Promise<MemoryListResult>;
    inspect(evidenceId: string): Promise<MemorySourceItem>;
    health(scopes: readonly string[]): Promise<MemoryHealth>;
}
/** Async SDK boundary shared by embedded and future remote adapters. */
export interface MemoryAddRequest {
    idempotencyKey: string;
    scope: string;
    content: string;
    source: {
        id: string;
        version: number;
        stream?: string;
    };
    kind?: "message" | "observation" | "action_result" | "state_change" | "document_revision" | "correction";
    subjects?: readonly string[];
    occurredAt?: string;
    /** Descriptive source metadata only; trusted actor identity and authority are adapter-bound. */
    sourceMetadata?: Partial<Pick<SourceMetadata, "toolOutcome" | "derivedFromEvidenceId" | "timezone">>;
    processing?: {
        defer?: boolean;
        expectedSnapshot?: SearchSnapshot;
    };
}
export interface MemoryAddResult {
    id: string;
    processingId: string;
    version: number;
    duplicate: boolean;
    readiness: {
        evidence: "durable";
        retrieval: "lexical_ready";
        memory: ProcessingState;
    };
}
export interface MemorySearchRequest {
    query: string;
    scopes: readonly string[];
    maxBytes?: number;
    maxTokens?: number;
    maxEstimatedTokens?: number;
    limit?: number;
    consistency?: "available" | "strict";
    minVersion?: number;
}
export interface MemorySearchResult {
    format: "recanta-memory-search-v1";
    context: RecallBody;
    contextText: string;
    bytes: number;
    version: number;
    snapshot: SearchSnapshot;
}
/**
 * The authenticated trusted integration (service/session) allowed to reach Recanta.
 * It binds namespace, scopes and write policy for the client lifetime. It is distinct
 * from the per-write source actor and from reconciliation authority.
 */
export interface TrustedIntegrationPrincipal {
    /** Stable identifier for the authenticated trusted integration or session. */
    id: string;
    /** Default source provenance for the untrusted `add()` path and `addTrusted()` fallback. */
    source: TrustedSourceProvenance;
    /** Source actor types this principal may attribute evidence to through `addTrusted()`. */
    allowedSources?: ReadonlyArray<SourceMetadata["actorType"]>;
    /** Whether this principal's trusted path may assert reconciliation authority. */
    grantAuthority?: boolean;
}
/**
 * The actor/source that produced one evidence item. Supplied by the trusted integration
 * layer per write, never by an untrusted public request body. It does not, by itself,
 * establish reconciliation authority; that is gated by principal policy.
 */
export interface TrustedSourceProvenance {
    actorId: string;
    actorType: SourceMetadata["actorType"];
    /** Requested reconciliation authority; honored only when the principal may grant it. */
    authority?: "approved" | "observation";
}
export interface MemoryClient {
    add(request: MemoryAddRequest): Promise<MemoryAddResult>;
    search(request: MemorySearchRequest): Promise<MemorySearchResult>;
    get(evidenceId: string): Promise<Evidence>;
    processing(processingId: string): Promise<ProcessingRun>;
    retry(processingId: string): Promise<ProcessingRun>;
}
