import { check } from "../errors.js";
import { lexicalScore } from "./text.js";
export const BM25 = { k1: 1.2, b: 0.75 };
export const RRF_K = 60;
/** Statistics must come from the authorized current-source corpus only. */
export function bm25Scores(tokens, terms) {
    const documents = tokens.map(text => text ? text.split(" ") : []);
    const meanLength = documents.reduce((sum, doc) => sum + doc.length, 0) / (documents.length || 1);
    const frequencies = documents.map(doc => { const f = new Map(); for (const word of doc)
        f.set(word, (f.get(word) ?? 0) + 1); return f; });
    const df = new Map(terms.map(term => [term, frequencies.filter(f => f.has(term)).length]));
    return frequencies.map((f, i) => terms.reduce((score, term) => {
        const count = f.get(term) ?? 0;
        if (!count)
            return score;
        const inverse = Math.log(1 + (documents.length - df.get(term) + 0.5) / (df.get(term) + 0.5));
        return score + inverse * count * (BM25.k1 + 1) / (count + BM25.k1 * (1 - BM25.b + BM25.b * documents[i].length / (meanLength || 1)));
    }, 0));
}
export function lexicalScores(tokens, terms) {
    return tokens.map(tokens => terms.length ? lexicalScore(tokens, terms.join(" ")) : 0);
}
export function validateVectors(input, count) {
    check(Array.isArray(input) && input.length === count, "INVALID_INPUT", "Embedding response count does not match input.");
    let dimensions = 0;
    return input.map(vector => {
        check(Array.isArray(vector) && vector.length > 0 && vector.length <= 4096, "INVALID_INPUT", "Invalid embedding dimensions.");
        if (!dimensions)
            dimensions = vector.length;
        check(vector.length === dimensions && vector.every(n => typeof n === "number" && Number.isFinite(n)), "INVALID_INPUT", "Embedding dimensions and values must be consistent and finite.");
        const norm = Math.hypot(...vector);
        check(Number.isFinite(norm) && norm > 0, "INVALID_INPUT", "Embedding must have a finite nonzero norm.");
        return vector.map(n => n / norm);
    });
}
export function cosineScores(vectors) {
    const query = vectors[0];
    return vectors.slice(1).map(vector => vector.reduce((sum, n, i) => sum + n * query[i], 0));
}
export function ranked(scores, positiveOnly = true) {
    return scores.map((_, i) => i).filter(i => !positiveOnly || scores[i] > 0).sort((a, b) => scores[b] - scores[a] || a - b);
}
export function reciprocalRankFusion(lexical, dense) {
    const scores = new Map();
    for (const list of [lexical, dense])
        list.forEach((index, rank) => scores.set(index, (scores.get(index) ?? 0) + 1 / (RRF_K + rank + 1)));
    return scores;
}
