export declare const BM25: {
    k1: number;
    b: number;
};
export declare const RRF_K = 60;
/** Statistics must come from the authorized current-source corpus only. */
export declare function bm25Scores(tokens: readonly string[], terms: readonly string[]): number[];
export declare function lexicalScores(tokens: readonly string[], terms: readonly string[]): number[];
export declare function validateVectors(input: unknown, count: number): number[][];
export declare function cosineScores(vectors: readonly number[][]): number[];
export declare function ranked(scores: readonly number[], positiveOnly?: boolean): number[];
export declare function reciprocalRankFusion(lexical: readonly number[], dense: readonly number[]): Map<number, number>;
