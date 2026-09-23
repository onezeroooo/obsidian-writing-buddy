import type { Access } from "./contracts.ts";
import { SqliteEventStore } from "./store/sqlite.ts";
import type { SqlDatabase } from "./store/driver.ts";
import type { MemoryProcessor, ProcessingOptions, ProcessingRun, RawSource, RetainReceipt } from "./processing/contracts.ts";
import type { ContextResult } from "./context/contracts.ts";
import type { MemoryDiscoveryRequest, MemoryDiscoveryResult, RecallRequest } from "./context/recall-contracts.ts";
import { type AdvancedRetrievalOptions, type AdvancedSearchRequest, type AdvancedSearchResult } from "./retrieval/advanced-contracts.ts";
import type { EpisodeRequest, EpisodeResult } from "./retrieval/episodes.ts";
import type { Inspection, EvidenceInspection } from "./inspector/contracts.ts";
import type { SearchSnapshot } from "./retrieval/contracts.ts";
import type { ContextBudgetPolicy } from "./context/budget.ts";
import { type EngineInfo } from "./version.ts";
import type { DocumentReceipt, DocumentRevision, DocumentState, LifecycleReceipt, RebuildReport, RetainDocumentOptions } from "./host/contracts.ts";
import type { ArtifactStore, ExportRequest, ExportResult, ImportReport, PortableArtifact, SyncReport } from "./portable/contracts.ts";
/** Embedded facade; inherited low-level capabilities keep their original contracts. */
export declare class SqliteRecanta extends SqliteEventStore implements MemoryProcessor {
    #private;
    constructor(database: string | SqlDatabase, options?: ProcessingOptions & {
        rebuildSearchIndex?: boolean;
        retrieval?: AdvancedRetrievalOptions;
        context?: ContextBudgetPolicy;
    });
    retain(access: Access, source: RawSource, options?: {
        defer?: boolean;
        expectedSnapshot?: SearchSnapshot;
    }): Promise<RetainReceipt>;
    /**
     * Host document contract: register or replace a document revision by stable identity.
     * Identical content is idempotent without new evidence, an exact replay returns the
     * original receipt, and a revision older than the head is rejected or ignored.
     */
    retainDocument(access: Access, input: DocumentRevision, options?: RetainDocumentOptions): Promise<DocumentReceipt>;
    documentState(access: Access, scopeId: string, sourceId: string): DocumentState;
    /** Removes a document from current retrieval and memory without discarding its history. */
    deleteDocument(access: Access, scopeId: string, sourceId: string, options?: {
        reason?: string;
    }): LifecycleReceipt;
    /** Reverses a deletion; the retained head revision and its processed memory become current again. */
    restoreDocument(access: Access, scopeId: string, sourceId: string): LifecycleReceipt;
    /**
     * Marks one revision's derived knowledge as untrustworthy: its passages leave retrieval,
     * its processing cannot publish, and claims citing it need review until an explicit
     * correction or a newer revision replaces them. The raw evidence stays for provenance.
     */
    invalidateEvidence(access: Access, evidenceId: string, options?: {
        reason?: string;
    }): LifecycleReceipt;
    /** Portable knowledge for the authorized scopes: evidence, extraction output, decisions, fact transitions, lifecycle. */
    exportArtifacts(access: Access, request: ExportRequest): ExportResult;
    /** Applies artifacts from any device; idempotent, order-tolerant and model-free. See ImportReport for skips. */
    importArtifacts(access: Access, artifacts: readonly PortableArtifact[]): ImportReport;
    /**
     * File-level synchronization against a host storage adapter: writes every local artifact
     * that the store lacks (files are immutable, so presence is sufficient) and imports every
     * store file this device has not applied. Transport between devices is the host's job.
     */
    syncArtifacts(access: Access, store: ArtifactStore, request: ExportRequest): Promise<SyncReport>;
    /** Engine identity, storage schema, local index identity and capability list. */
    engineInfo(): EngineInfo;
    /** Rebuilds every device-local projection from authoritative rows. No model call, no artifact needed. */
    rebuildLocalState(): RebuildReport;
    processingStatus(access: Access, processingId: string): ProcessingRun;
    retryProcessing(access: Access, processingId: string): Promise<ProcessingRun>;
    discoverFacts(access: Access, request: MemoryDiscoveryRequest): MemoryDiscoveryResult;
    recallContext(access: Access, request: RecallRequest): ContextResult;
    searchAdvanced(access: Access, request: AdvancedSearchRequest): Promise<AdvancedSearchResult>;
    searchEpisodes(access: Access, request: EpisodeRequest): EpisodeResult;
    inspectContext(access: Access, request: RecallRequest): Inspection;
    healthState(access: Access, requested: readonly string[]): {
        version: number;
        counts: Record<string, number>;
        ready: boolean;
    };
    inspectEvidence(access: Access, evidenceId: string): EvidenceInspection;
}
