import type { Access, ScopeSnapshot } from "../contracts.ts";
export interface FactKey {
    scopeId: string;
    subjectId: string;
    predicate: string;
}
export type FactValue = string | number | boolean;
export interface Assertion {
    value: FactValue;
    mode: "asserted" | "proposed" | "inferred";
    evidenceIds: readonly string[];
}
export interface Claim extends Assertion {
    id: string;
}
export interface ClaimWrite extends FactKey {
    /** Unique per namespace. Identical replay returns the original receipt. */
    operationId: string;
    /** Mandatory slot CAS, including zero for an empty slot. */
    expectedRevision: number;
    cardinality: "single" | "multiple";
    /** Evidence for the transition itself, including withdrawal. */
    evidenceIds: readonly string[];
    action: {
        kind: "add";
        assertion: Assertion;
    } | {
        kind: "replace";
        targetIds: readonly string[];
        reason: "correction" | "supersession";
        assertion: Assertion;
    }
    /** The transition evidence joins the targets' support; the active-claim set does not grow. */
     | {
        kind: "support";
        targetIds: readonly string[];
    } | {
        kind: "retract";
        targetIds: readonly string[];
    };
}
export interface ClaimReceipt {
    operationId: string;
    revision: number;
    version: number;
    duplicate: boolean;
}
export interface ClaimRevision extends FactKey {
    operationId: string;
    revision: number;
    version: number;
    recordedAt: string;
    cardinality: "single" | "multiple";
    action: ClaimWrite["action"];
    evidenceIds: readonly string[];
    /** Active assertions after this transition; prior revisions preserve withdrawn assertions. */
    claims: Claim[];
}
export interface FactState extends FactKey {
    revision: number;
    /** Consistent namespace read boundary, also usable as knownAtVersion. */
    version: number;
    cardinality: "single" | "multiple" | null;
    status: "empty" | "unresolved" | "resolved" | "conflict" | "needs_review";
    /** `evidenceCurrent`: at least one cited revision is still the current, non-invalidated head of its source. */
    claims: Array<Claim & {
        evidenceCurrent: boolean;
    }>;
    /** Empty unless resolved. Proposals/inferences are never effective values. */
    values: FactValue[];
    snapshot: ScopeSnapshot;
}
export interface ClaimHistoryRequest extends FactKey {
    afterRevision?: number;
    limit?: number;
}
export interface ClaimStore {
    writeClaim(access: Access, request: ClaimWrite): ClaimReceipt;
    fact(access: Access, key: FactKey, options?: {
        knownAtVersion?: number;
        positionBoundary?: string;
    }): FactState;
    claimHistory(access: Access, request: ClaimHistoryRequest): ClaimRevision[];
}
