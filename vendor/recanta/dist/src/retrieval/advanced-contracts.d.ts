import type { Access } from "../contracts.ts";
import type { ProviderUsage } from "../processing/contracts.ts";
import type { EvidenceCitation, SearchHit, SearchSnapshot } from "./contracts.ts";
export type RetrievalMethod = "lexical" | "bm25" | "lexical_bm25_rrf" | "dense" | "hybrid";
export declare const DEFAULT_MAX_CORPUS_PASSAGES = 2000;
export interface EmbeddingProvider {
    readonly fingerprint: string;
    embed(input: {
        texts: readonly string[];
        signal: AbortSignal;
    }): Promise<{
        vectors: unknown;
        usage: ProviderUsage;
    }>;
}
export interface AdvancedSearchRequest {
    scopes: readonly string[];
    query: string;
    method: RetrievalMethod;
    limit?: number;
    candidateLimit?: number;
    maxQuoteBytes?: number;
}
export interface RankedCandidate {
    citation: EvidenceCitation;
    rank: number;
    score: number;
    lexicalRank: number | null;
    denseRank: number | null;
}
export interface AdvancedSearchResult {
    method: RetrievalMethod;
    version: number;
    snapshot: SearchSnapshot;
    hits: SearchHit[];
    /** Pre-packing candidates make candidate recall distinct from returned recall. */
    candidates: RankedCandidate[];
    quoteBytes: number;
    omittedForBudget: number;
    hasMoreMatches: boolean;
    diagnostics: {
        corpusPassages: number;
        candidateLimit: number;
        bm25: {
            k1: number;
            b: number;
        };
        rrfK: number;
        embeddingFingerprint: string | null;
        usage: ProviderUsage | null;
    };
}
export interface AdvancedRetrievalOptions {
    embeddingProvider?: EmbeddingProvider;
    /** Fail rather than silently rank a truncated corpus. */
    maxCorpusPassages?: number;
    maxEmbeddingBytes?: number;
    embeddingTimeoutMs?: number;
}
export interface AdvancedRetriever {
    searchAdvanced(access: Access, request: AdvancedSearchRequest): Promise<AdvancedSearchResult>;
}
