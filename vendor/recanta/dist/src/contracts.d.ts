/** Supplied by a trusted host after authentication. This is not authentication itself. */
export interface Access {
    namespaceId: string;
    readScopes: readonly string[];
    writeScopes: readonly string[];
}
export type EventKind = "message" | "observation" | "action_result" | "state_change" | "document_revision" | "correction";
export interface MemoryEvent {
    streamId: string;
    eventId: string;
    scopeId: string;
    sourceId: string;
    /** Positive, strictly increasing per source within its namespace and scope. */
    sourceVersion: number;
    subjectIds: readonly string[];
    kind: EventKind;
    content: string;
    occurredAt?: string;
}
export interface Evidence {
    id: string;
    namespaceId: string;
    scopeId: string;
    streamId: string;
    eventId: string;
    sourceId: string;
    sourceVersion: number;
    subjectIds: string[];
    kind: EventKind;
    content: string;
    contentHash: string;
    occurredAt: string | null;
    recordedAt: string;
    version: number;
}
export interface Receipt {
    evidenceId: string;
    version: number;
    duplicate: boolean;
    readiness: {
        evidence: "durable";
        retrieval: "lexical_ready";
        memory: "not_requested";
    };
}
export interface WriteOptions {
    /** Optional namespace CAS. Replaying an already accepted identical event is still idempotent. */
    expectedVersion?: number;
}
export interface FeedRequest {
    scopes: readonly string[];
    afterVersion?: number;
    limit?: number;
}
/** A change feed record is durable; it is not a leased or acknowledged job. */
export interface Change {
    id: string;
    scopeId: string;
    evidenceId: string;
    version: number;
    kind: "evidence.ingested";
}
export interface ScopeSnapshot {
    namespaceId: string;
    generations: Record<string, number>;
}
/** Initial synchronous embedded contract. Not yet a stable published SDK. */
export interface EventStore {
    ingest(access: Access, event: MemoryEvent, options?: WriteOptions): Receipt;
    evidence(access: Access, evidenceId: string): Evidence;
    sourceHead(access: Access, scopeId: string, sourceId: string, options?: {
        includeDeleted?: boolean;
    }): Evidence;
    events(access: Access, request: FeedRequest): Evidence[];
    changes(access: Access, request: FeedRequest): Change[];
    snapshot(access: Access, scopes: readonly string[]): ScopeSnapshot;
    isFresh(access: Access, snapshot: ScopeSnapshot): boolean;
    close(): void;
}
