import type { ClaimRevision, FactKey } from "../memory/contracts.ts";
import type { ProcessingRun } from "../processing/contracts.ts";
import type { ContextResult } from "../context/contracts.ts";
import type { RecallBody } from "../context/recall-contracts.ts";
import type { Evidence } from "../contracts.ts";
import type { ContextPlan } from "../context/plan.ts";
export interface Inspection {
    context: ContextResult;
    plan: ContextPlan;
    body: RecallBody;
    facts: Array<{
        key: FactKey;
        selection: "required" | "discovered";
        score: number | null;
        history: ClaimRevision[];
        hasEarlierHistory: boolean;
    }>;
}
export interface EvidenceInspection {
    evidence: Evidence;
    current: boolean;
    runs: ProcessingRun[];
    hasMoreRuns: boolean;
}
