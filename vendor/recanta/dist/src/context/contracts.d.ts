import type { Access } from "../contracts.ts";
import type { FactKey, FactState } from "../memory/contracts.ts";
import type { SearchHit, SearchSnapshot } from "../retrieval/contracts.ts";
export interface ContextRequest {
    scopes: readonly string[];
    query: string;
    /** Explicit host-selected slots, not automatic fact discovery. Maximum 16. */
    facts: readonly FactKey[];
    maxBytes: number;
    sourceLimit?: number;
    minVersion?: number;
}
export interface ContextSource extends SearchHit {
    /** Evidence-level associations, not semantic entailment of this passage. */
    factLinks: Array<FactKey & {
        relation: "active_support" | "historical_support";
    }>;
}
export interface ContextBody {
    format: "recanta-context-v1";
    interpretation: string;
    version: number;
    facts: Array<Omit<FactState, "snapshot">>;
    sources: ContextSource[];
    omittedSources: number;
    hasMoreSources: boolean;
}
export interface ContextResult {
    /** JSON serialized ContextBody. maxBytes covers this entire string. */
    text: string;
    bytes: number;
    snapshot: SearchSnapshot;
}
export interface ContextCompiler {
    compileContext(access: Access, request: ContextRequest): ContextResult;
    isContextFresh(access: Access, snapshot: SearchSnapshot): boolean;
}
