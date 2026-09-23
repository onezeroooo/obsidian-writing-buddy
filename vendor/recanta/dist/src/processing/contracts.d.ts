import type { Access, Evidence, MemoryEvent, Receipt, ScopeSnapshot } from "../contracts.ts";
import type { FactKey, FactValue, ClaimWrite } from "../memory/contracts.ts";
import type { EvidenceCitation } from "../retrieval/contracts.ts";
import type { SearchSnapshot } from "../retrieval/contracts.ts";
import type { CandidateDimensions } from "./dimensions.ts";
/** Authenticated source metadata, supplied by the host, never by extraction. */
export interface SourceMetadata {
    actorId?: string;
    actorType: "person" | "assistant" | "tool" | "document";
    authority?: "approved" | "observation";
    toolOutcome?: "attempted" | "succeeded" | "failed" | "unknown";
    derivedFromEvidenceId?: string;
    /** Explicit IANA timezone used only to anchor candidate calendar expressions. */
    timezone?: string;
}
export interface RawSource extends Omit<MemoryEvent, "subjectIds"> {
    subjectIds?: readonly string[];
    metadata: SourceMetadata;
}
export interface SourceSpan {
    start: number;
    end: number;
    quote: string;
}
export interface ExtractedCandidate {
    /** Empty subject means the authenticated speaker, not an invented entity. */
    subject: string;
    predicate: string;
    value: string;
    assertionMode: "assertion" | "proposal" | "hypothesis" | "quotation" | "negation";
    intent: "assert" | "correct" | "retract";
    span: SourceSpan;
    qualifiers: string[];
    temporalExpression: string | null;
    confidence: number | null;
    uncertainty: string[];
}
export interface ExtractionOutput {
    candidates: ExtractedCandidate[];
    unresolved: Array<SourceSpan & {
        reason: string;
    }>;
    /** Engine-computed coverage after provider schema validation. */
    coverage?: {
        complete: boolean;
        uncoveredRegions: number;
        detailedRegions: number;
    };
    /** Candidates the engine set aside for failing their own checks or exceeding the limit; each is a gap in `unresolved` when its quote was in the source. */
    rejected?: number;
}
export interface ProviderUsage {
    inputTokens: number;
    outputTokens: number;
    costUsd?: number;
}
export interface ExtractionInput {
    evidence: Evidence;
    metadata: SourceMetadata;
    signal: AbortSignal;
    maxOutputTokens: number;
}
/** Recanta ships providers; this interface also permits controlled adapters/tests. */
export interface ExtractionProvider {
    readonly fingerprint: string;
    readonly method: "rules" | "model";
    extract(input: ExtractionInput): Promise<{
        output: unknown;
        usage: ProviderUsage;
    }>;
}
export interface Vocabulary {
    /** Exact normalized aliases only; ambiguous aliases are rejected at configuration. */
    subjects?: Readonly<Record<string, string>>;
    predicates?: Readonly<Record<string, string>>;
}
export interface ProcessingOptions {
    provider?: ExtractionProvider;
    vocabulary?: Vocabulary;
    maxAttempts?: number;
    timeoutMs?: number;
    maxInputBytes?: number;
    maxOutputBytes?: number;
    maxOutputTokens?: number;
    minimumConfidence?: number;
}
export interface Candidate {
    id: string;
    raw: ExtractedCandidate;
    evidence: EvidenceCitation;
    extraction: {
        method: "rules" | "model";
        fingerprint: string;
    };
    /** Absent on legacy candidates; qualifiers never become scalar slot identity implicitly. */
    dimensions?: CandidateDimensions;
    normalization: {
        version: string;
        subjectId: string | null;
        predicate: string | null;
        value: FactValue | null;
        unit: string | null;
        ambiguities: string[];
    };
}
export interface CandidateDecision {
    candidate: Candidate;
    acceptance: "accepted" | "unresolved";
    relation: "add" | "support" | "correction" | "retraction" | "supersession" | "conflict" | "unresolved";
    reason: string;
    authority: {
        actorId: string | null;
        source: SourceMetadata["actorType"];
        approval: boolean;
    };
    key: FactKey | null;
    claimId: string | null;
    targetIds: string[];
}
export type ProcessingState = "requested" | "processing" | "completed" | "partial" | "failed" | "superseded";
export interface ProcessingRun {
    id: string;
    namespaceId: string;
    scopeId: string;
    evidenceId: string;
    sourceVersion: number;
    sourceHash: string;
    pipelineFingerprint: string;
    providerFingerprint: string;
    status: ProcessingState;
    metadata: SourceMetadata;
    attempts: number;
    maxAttempts: number;
    leaseToken: string | null;
    leaseUntil: number | null;
    output: ExtractionOutput | null;
    usage: ProviderUsage[];
    dependencies: ScopeSnapshot | null;
    slotRevisions: Array<FactKey & {
        revision: number;
    }>;
    decisions: CandidateDecision[];
    failure: {
        code: string;
        message: string;
    } | null;
    createdAt: string;
    updatedAt: string;
}
export interface ProcessingPlan {
    runId: string;
    leaseToken: string;
    snapshot: ScopeSnapshot;
    slots: Array<FactKey & {
        revision: number;
    }>;
    decisions: CandidateDecision[];
    writes: ClaimWrite[];
}
export interface RetainReceipt extends Omit<Receipt, "readiness"> {
    processingId: string;
    readiness: {
        evidence: "durable";
        retrieval: "lexical_ready";
        memory: ProcessingState;
    };
}
export interface MemoryProcessor {
    retain(access: Access, source: RawSource, options?: {
        defer?: boolean;
        expectedSnapshot?: SearchSnapshot;
    }): Promise<RetainReceipt>;
    processingStatus(access: Access, processingId: string): ProcessingRun;
    retryProcessing(access: Access, processingId: string): Promise<ProcessingRun>;
}
