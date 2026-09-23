import type { Access, ScopeSnapshot } from "../contracts.ts";
export interface SearchRequest {
    query: string;
    scopes: readonly string[];
    subjectId?: string;
    limit?: number;
    /** Exact sum of returned quote bytes, excluding metadata. Not a token budget. */
    maxQuoteBytes?: number;
    minVersion?: number;
}
export interface EvidenceCitation {
    evidenceId: string;
    sourceId: string;
    sourceVersion: number;
    contentHash: string;
    /** Half-open JavaScript UTF-16 offsets into the exact original evidence. */
    start: number;
    end: number;
    offsetUnit: "utf16";
}
export interface SearchHit {
    citation: EvidenceCitation;
    scopeId: string;
    text: string;
    /** Deterministic lexical relevance, not confidence or probability. */
    score: number;
}
export interface SearchSnapshot extends ScopeSnapshot {
    indexVersion: string;
}
export interface SearchResult {
    method: "lexical";
    hits: SearchHit[];
    snapshot: SearchSnapshot;
    version: number;
    quoteBytes: number;
    omittedForBudget: number;
    hasMoreMatches: boolean;
}
/** Retrieval is a capability separate from authoritative event ingestion. */
export interface EvidenceRetriever {
    search(access: Access, request: SearchRequest): SearchResult;
    resolveCitation(access: Access, citation: EvidenceCitation, options?: {
        requireCurrent?: boolean;
    }): string;
    isSearchFresh(access: Access, snapshot: SearchSnapshot): boolean;
}
