import type { SqlDatabase } from "../store/driver.ts";
import type { SearchHit } from "./contracts.ts";
export interface Bm25Candidate extends SearchHit {
    id: string;
    tokens: string;
    rank: number;
    matchedTerms: readonly string[];
    /** Matched terms excluding common stopwords; drives eligibility tiers, not ranking. */
    meaningfulMatchedTerms: readonly string[];
    queryTermCount: number;
}
/** One authorized exact corpus read for the canonical BM25 baseline. */
export declare function rankBm25Candidates(db: SqlDatabase, namespaceId: string, scopes: readonly string[], terms: readonly string[], options: {
    candidateLimit: number;
    maxCorpusPassages: number;
    positionBoundary?: string;
}): {
    candidates: Bm25Candidate[];
    corpusPassages: number;
    hasMoreMatches: boolean;
};
