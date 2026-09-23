export declare const INDEX_VERSION: string;
export declare const MAX_PASSAGE_UNITS = 2048;
/** Normalization is for indexing only. Quotes always slice the untouched evidence. */
export declare function lexicalTerms(text: string): string[];
export declare function queryTerms(query: unknown): string[];
/**
 * Small, explicit lexical stopword list. This is a deterministic heuristic for the
 * current lexical baseline, not linguistic analysis: it only stops common function
 * words from counting as meaningful query coverage during context prioritization.
 * Ranking/BM25 statistics are unchanged; this only informs eligibility tiers.
 */
export declare const STOPWORDS: ReadonlySet<string>;
/** Query/candidate terms that carry topical signal, excluding common stopwords. */
export declare function meaningfulTerms(terms: readonly string[]): string[];
export declare function matchExpression(terms: readonly string[]): string;
/** No corpus-global statistics: unrelated scopes cannot alter scores or freshness. */
export declare function lexicalScore(tokens: string, query: string): number;
export interface Passage {
    start: number;
    end: number;
    text: string;
    tokens: string;
}
export declare function isBoundary(text: string, position: number): boolean;
export declare function passages(content: string): Passage[];
