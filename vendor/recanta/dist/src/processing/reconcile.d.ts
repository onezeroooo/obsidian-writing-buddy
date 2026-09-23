import type { ClaimWrite, FactState } from "../memory/contracts.ts";
import type { Candidate, CandidateDecision, ProcessingRun } from "./contracts.ts";
export interface ClaimOrigin {
    actorId: string | null;
    evidenceVersion: number;
    approved: boolean;
    /** Every source revision that supports the claim; a newer revision of one of them may supersede its own part. */
    sources?: ReadonlyArray<{
        sourceId: string;
        sourceVersion: number;
    }>;
}
/** Policy is deterministic and cannot acquire approval from provider output. */
export declare function reconcile(candidate: Candidate, run: ProcessingRun, state: Omit<FactState, "snapshot"> | null, origins: Map<string, ClaimOrigin>, evidenceVersion: number, minimumConfidence: number, source?: {
    sourceId: string;
    sourceVersion: number;
    positioned?: boolean;
}): {
    decision: CandidateDecision;
    write: ClaimWrite | null;
};
