import type { EventKind } from "../contracts.ts";
import type { FactKey, FactState } from "../memory/contracts.ts";
import type { ProcessingState, SourceMetadata } from "../processing/contracts.ts";
import type { SearchSnapshot } from "../retrieval/contracts.ts";
/**
 * One delivery of a document revision from a host. The host owns paths, titles and
 * rename handling; the kernel only sees the stable `sourceId`, a strictly increasing
 * `revision`, exact content and its hash. Nothing here may carry a filesystem path.
 */
export interface DocumentRevision {
    scopeId: string;
    /** Stable document identity. A rename keeps it; a different document never reuses it. */
    sourceId: string;
    /** Host revision counter for this document, strictly increasing. */
    revision: number;
    content: string;
    /** Optional SHA-256 hex of `content`; verified when supplied so a corrupted delivery is refused. */
    contentHash?: string;
    kind?: EventKind;
    subjectIds?: readonly string[];
    occurredAt?: string;
    /**
     * Sortable ordering key (a story position such as a zero-padded chapter index). Compared
     * lexicographically. Absent means unpositioned: visible under every boundary.
     */
    position?: string;
    /** Idempotency stream; defaults to "documents". */
    streamId?: string;
    metadata: SourceMetadata;
}
export interface RetainDocumentOptions {
    /** Leave processing requested instead of awaiting it. */
    defer?: boolean;
    /** How to treat a revision older than the accepted head. Default rejects with VERSION_CONFLICT. */
    onStale?: "reject" | "ignore";
    expectedSnapshot?: SearchSnapshot;
}
export interface DocumentReceipt {
    /**
     * accepted: new evidence and processing were recorded.
     * duplicate: this exact (revision, content) was already delivered.
     * unchanged: the current head already has this content; no new evidence.
     * stale: an older revision arrived after a newer one and was ignored.
     */
    outcome: "accepted" | "duplicate" | "unchanged" | "stale";
    sourceId: string;
    /** Revision of the evidence now serving as head. */
    revision: number;
    contentHash: string;
    evidenceId: string;
    /** Namespace commit version after the operation. */
    version: number;
    processingId: string | null;
    readiness: {
        evidence: "durable";
        retrieval: "lexical_ready";
        memory: ProcessingState;
    } | null;
    /** Fact slots whose accepted claims cite the replaced revision; their state may now need review. */
    affectedFacts: AffectedFact[];
}
export interface AffectedFact extends FactKey {
    status: FactState["status"];
}
export interface DocumentState {
    scopeId: string;
    sourceId: string;
    deleted: boolean;
    position: string | null;
    head: {
        revision: number;
        evidenceId: string;
        contentHash: string;
        recordedAt: string;
        version: number;
        invalidated: boolean;
    } | null;
    revisions: number;
    /** Latest processing run for the head revision, if any. */
    processing: {
        id: string;
        status: ProcessingState;
    } | null;
}
export interface LifecycleReceipt {
    outcome: "applied" | "noop";
    kind: "deleted" | "restored" | "invalidated";
    scopeId: string;
    sourceId: string;
    evidenceId: string | null;
    version: number;
    affectedFacts: AffectedFact[];
}
/** Retrieval/context boundary: only sources positioned at or before `position` (plus unpositioned sources) are visible. */
export interface SourceBoundary {
    position: string;
}
export interface RebuildReport {
    passages: number;
    slots: number;
    indexVersion: string;
    acceleration: "fts5" | "scan";
}
