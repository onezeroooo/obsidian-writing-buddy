import type { SqlDatabase } from "./driver.ts";
import type { Access, Change, EventStore, Evidence, FeedRequest, MemoryEvent, Receipt, ScopeSnapshot, WriteOptions } from "../contracts.ts";
import type { EvidenceCitation, EvidenceRetriever, SearchRequest, SearchResult, SearchSnapshot } from "../retrieval/contracts.ts";
import { SqliteLexicalIndex } from "../retrieval/sqlite-index.ts";
import { SqliteClaims } from "../memory/sqlite-claims.ts";
import type { ClaimStore, ClaimWrite, ClaimReceipt, FactKey, FactState, ClaimHistoryRequest, ClaimRevision } from "../memory/contracts.ts";
import type { ContextCompiler, ContextRequest, ContextResult } from "../context/contracts.ts";
/**
 * Synchronous embedded implementation. All source changes are transactionally durable.
 * The database is either a filename opened through Node's built-in SQLite or an injected
 * `SqlDatabase` driver (browser/mobile hosts). The store owns and closes either one.
 */
export declare class SqliteEventStore implements EventStore, EvidenceRetriever, ClaimStore, ContextCompiler {
    #private;
    protected get database(): SqlDatabase;
    protected get lexicalIndex(): SqliteLexicalIndex;
    protected get claimStore(): SqliteClaims;
    constructor(database: string | SqlDatabase, options?: {
        rebuildSearchIndex?: boolean;
    });
    /** Synchronous component composition only; provider work must stay outside. */
    protected transaction<T>(mode: "IMMEDIATE" | "DEFERRED", action: () => T): T;
    ingest(access: Access, input: MemoryEvent, options?: WriteOptions): Receipt;
    evidence(access: Access, evidenceId: string): Evidence;
    /** Latest accepted revision. A deleted document has no current head unless `includeDeleted` is set. */
    sourceHead(access: Access, scopeId: string, sourceId: string, options?: {
        includeDeleted?: boolean;
    }): Evidence;
    /** Head plus lifecycle columns for internal callers; read scope is enforced. */
    protected headRow(access: Access, scopeId: string, sourceId: string): {
        evidence: Evidence;
        deleted: boolean;
        position: string | null;
    } | undefined;
    events(access: Access, request: FeedRequest): Evidence[];
    changes(access: Access, request: FeedRequest): Change[];
    snapshot(access: Access, requested: readonly string[]): ScopeSnapshot;
    isFresh(access: Access, snapshot: ScopeSnapshot): boolean;
    search(access: Access, request: SearchRequest): SearchResult;
    resolveCitation(access: Access, citation: EvidenceCitation, options?: {
        requireCurrent?: boolean;
    }): string;
    isSearchFresh(access: Access, snapshot: SearchSnapshot): boolean;
    writeClaim(access: Access, request: ClaimWrite): ClaimReceipt;
    fact(access: Access, key: FactKey, options?: {
        knownAtVersion?: number;
        positionBoundary?: string;
    }): FactState;
    claimHistory(access: Access, request: ClaimHistoryRequest): ClaimRevision[];
    compileContext(access: Access, request: ContextRequest): ContextResult;
    isContextFresh(access: Access, snapshot: SearchSnapshot): boolean;
    close(): void;
}
