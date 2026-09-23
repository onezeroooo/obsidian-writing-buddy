import type { FactKey, FactState } from "../memory/contracts.ts";
import type { CandidateDecision, ProcessingState } from "../processing/contracts.ts";
import type { EvidenceCitation } from "../retrieval/contracts.ts";
import type { ContextResult, ContextSource } from "./contracts.ts";
export interface RecallRequest {
    scopes: readonly string[];
    query: string;
    maxBytes: number;
    /** Exact model-token limit; requires an injected exact token counter. */
    maxTokens?: number;
    /** Explicit heuristic limit when an exact tokenizer is unavailable. */
    maxEstimatedTokens?: number;
    factLimit?: number;
    sourceLimit?: number;
    requiredFacts?: readonly FactKey[];
    /** Refuse incomplete processing in the selected scopes, including unresolved candidates. */
    requireReady?: boolean;
    minVersion?: number;
    /** Bounded current-stream neighbors; proximity supplies context, never authority. */
    episodeNeighborLimit?: number;
    /**
     * Story-position boundary. Positioned sources after it are invisible to retrieval,
     * readiness and fact state; unpositioned sources always count. Lexicographic compare.
     */
    boundary?: {
        position: string;
    };
}
export interface MemoryDiscoveryRequest {
    scopes: readonly string[];
    query: string;
    limit?: number;
}
export interface MemoryDiscoveryResult {
    facts: Array<FactKey & {
        score: number;
    }>;
    hasMore: boolean;
    snapshot: ContextResult["snapshot"];
}
export interface RecallBody {
    format: "recanta-recall-v1";
    interpretation: string;
    version: number;
    facts: Array<Omit<FactState, "snapshot">>;
    hasMoreFacts: boolean;
    /**
     * Required supporting evidence, deduplicated at rendered citation granularity: one
     * exact citation renders once and carries every fact-support relationship it backs.
     */
    evidence: Array<{
        citation: EvidenceCitation;
        text: string;
        supports: Array<{
            claimId: string;
            relation: "accepted_support" | "unresolved_support" | "stale_support";
            decision: Pick<CandidateDecision, "authority" | "relation"> | null;
        }>;
    }>;
    contextualEvidence: Array<{
        relation: "episode_neighbor";
        anchorEvidenceId: string;
        citation: EvidenceCitation;
        text: string;
    }>;
    sources: ContextSource[];
    /**
     * Compact high-level readiness for normal agent context. Detailed per-source gap
     * identities stay in the internal ContextPlan and Inspector, not in this rendered body.
     */
    processing: {
        ready: boolean;
        counts: Record<ProcessingState | "not_requested", number>;
        gapCount: number;
    };
    unresolved: Array<{
        processingId: string;
        decision: CandidateDecision;
    }>;
    omittedSources: number;
    hasMoreSources: boolean;
    omittedUnresolved: number;
}
