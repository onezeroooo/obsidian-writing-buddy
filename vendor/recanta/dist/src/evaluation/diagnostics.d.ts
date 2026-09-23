import type { EvidenceCitation } from "../retrieval/contracts.ts";
/** Evaluation labels never enter extraction, indexing, ranking or context packing. */
export interface GoldEvidence {
    sourceId: string;
    spans?: Array<{
        start: number;
        end: number;
    }>;
}
export interface RecallMetrics {
    answerTurnRecall: number | null;
    answerSpanRecall: number | null;
    candidateTurnRecall: number | null;
    candidateSpanRecall: number | null;
    missedTurns: string[];
    missedSpans: Array<{
        sourceId: string;
        start: number;
        end: number;
    }>;
}
export interface ContextPipelineMetrics extends RecallMetrics {
    candidateToContextSurvival: number | null;
    relevantCandidateSurvival: number | null;
    contextPrecision: number | null;
    citationCorrectness: number;
    requiredFactRetention: number | null;
    conflictRetention: number | null;
    contextBytes: number;
    contextTokens: number;
    tokenAccounting: "exact_tokenizer" | "estimated";
    latencyMs: number | null;
    providerUsage: {
        inputTokens: number;
        outputTokens: number;
        costUsd?: number;
    } | null;
}
export declare function retrievalDiagnostics(gold: readonly GoldEvidence[] | null, candidates: readonly EvidenceCitation[], returned: readonly EvidenceCitation[]): RecallMetrics;
/** Measures retrieval and final selection separately; labels remain evaluation-only. */
export declare function contextPipelineDiagnostics(input: {
    gold: readonly GoldEvidence[] | null;
    candidates: readonly EvidenceCitation[];
    returned: readonly EvidenceCitation[];
    validCitations: readonly EvidenceCitation[];
    requiredFacts?: {
        expected: number;
        retained: number;
    };
    conflicts?: {
        expected: number;
        retained: number;
    };
    contextBytes: number;
    contextTokens: number;
    tokenAccounting?: ContextPipelineMetrics["tokenAccounting"];
    latencyMs?: number;
    providerUsage?: ContextPipelineMetrics["providerUsage"];
}): ContextPipelineMetrics;
/** Exact match only; no inferred semantic judging and no credit for missing output. */
export declare function answerAccuracy(expected: readonly string[] | null, answer: string | undefined): {
    evaluated: boolean;
    exactMatch: boolean | null;
};
