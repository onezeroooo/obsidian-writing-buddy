import type { FactKey, FactState } from "../memory/contracts.ts";
import type { CandidateDecision, ProcessingState } from "../processing/contracts.ts";
import type { EvidenceCitation, SearchSnapshot } from "../retrieval/contracts.ts";
import type { ContextCost } from "./budget.ts";
import type { RecallBody } from "./recall-contracts.ts";
export type ContextOmissionReason = "budget" | "ineligible" | "duplicate_evidence" | "optional_limit" | "weak_low_priority";
export interface ContextPlanFact {
    key: FactKey;
    required: boolean;
    score: number | null;
    state: Omit<FactState, "snapshot">;
    cost: ContextCost;
}
export interface ContextPlanCandidate {
    id: string;
    citation: EvidenceCitation;
    scopeId: string;
    rank: number;
    score: number;
    text: string;
    matchedTerms: readonly string[];
    meaningfulMatchedTerms: readonly string[];
    queryTermCount: number;
    eligible: boolean;
    /** Coverage tier used for bounded prioritization: 1 = stronger coverage, 2 = single meaningful term. */
    tier: 1 | 2 | null;
    selected: boolean;
    section: "relevant_evidence" | "episode_context" | null;
    required: boolean;
    anchorEvidenceId?: string;
    inclusionReason?: "required_fact_support" | "eligible_evidence" | "episode_neighbor";
    omissionReason?: ContextOmissionReason;
    duplicateOf?: string;
    factLinks: RecallBody["sources"][number]["factLinks"];
    cost: ContextCost;
}
export interface ContextPlan {
    format: "recanta-context-plan-internal-v1";
    query: string;
    scopes: readonly string[];
    retrieval: {
        method: "bm25";
        corpusPassages: number;
        candidateCount: number;
        eligibleCount: number;
        selectedCount: number;
        episodeContribution: number;
        hasMoreMatches: boolean;
    };
    facts: ContextPlanFact[];
    candidates: ContextPlanCandidate[];
    unresolved: Array<{
        processingId: string;
        decision: CandidateDecision;
        selected: boolean;
        omissionReason?: "budget" | "optional_limit";
        cost: ContextCost;
    }>;
    /** Detailed processing readiness, including per-source gap identities. Internal/Inspector only. */
    processing: {
        ready: boolean;
        counts: Record<ProcessingState | "not_requested", number>;
        gapCount: number;
        gaps: Array<{
            processingId: string | null;
            evidenceId: string;
            status: ProcessingState | "not_requested";
        }>;
        omittedGaps: number;
    };
    body: Omit<RecallBody, "facts" | "sources" | "contextualEvidence" | "unresolved">;
    budget: {
        maxBytes: number;
        maxTokens: number | null;
        maxEstimatedTokens: number | null;
        accounting: ContextCost["tokens"];
        used: ContextCost;
        sections: Record<string, ContextCost>;
        optionalItemLimit: number;
    };
}
export interface ContextPlanResult {
    plan: ContextPlan;
    snapshot: SearchSnapshot;
}
