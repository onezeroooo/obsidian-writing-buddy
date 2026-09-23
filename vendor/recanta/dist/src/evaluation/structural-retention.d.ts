import type { EvidenceCitation } from "../retrieval/contracts.ts";
export type StructuralRetentionKind = "required_fragment" | "correction_fragment" | "negation_fragment" | "conflict_fragment";
export interface StructuralRetentionRequirement {
    id: string;
    kind: StructuralRetentionKind;
    sourceId: string;
    fragment: string;
    forbiddenFragment?: string;
}
export interface StructuralRetentionItem {
    text: string;
    citation: EvidenceCitation;
}
export interface StructuralRetentionResult {
    passed: boolean;
    checks: Array<{
        id: string;
        kind: StructuralRetentionKind;
        passed: boolean;
        matchingCitation: boolean;
        fragmentRetained: boolean;
        forbiddenAbsent: boolean;
    }>;
}
/** Evaluation-only structural check. It does not judge entailment, truth or semantic equivalence. */
export declare function evaluateStructuralRetention(items: readonly StructuralRetentionItem[], requirements: readonly StructuralRetentionRequirement[]): StructuralRetentionResult;
