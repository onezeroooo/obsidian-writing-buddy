import { check } from "../errors.js";
import { sha256Hex } from "../hash.js";
import { utf8Length } from "../runtime.js";
/**
 * Tokenizer behaviour depends on the JavaScript engine's Unicode tables (NFKC, case
 * folding, script properties). Instead of trusting a Node-only version string, the index
 * fingerprint hashes the tokenizer's own output for a fixed probe, so any runtime whose
 * tokenization differs fails closed and asks for an explicit rebuild.
 */
const TOKENIZER_PROBE = "Ｒecanta ＣＡＦÉ café 北京市天气 straße İstanbul ǅemal 12３ ① naïve résumé ｱｲｳ";
export const INDEX_VERSION = `paragraph-2048-lexical-v1:${sha256Hex(JSON.stringify(lexicalTerms(TOKENIZER_PROBE))).slice(0, 16)}`;
export const MAX_PASSAGE_UNITS = 2048;
/** Normalization is for indexing only. Quotes always slice the untouched evidence. */
export function lexicalTerms(text) {
    const words = text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}\p{M}]+/gu) ?? [];
    return words.flatMap(word => /\p{Script=Han}/u.test(word) ? [word, ...Array.from(word).filter(char => /\p{Script=Han}/u.test(char))] : [word]);
}
export function queryTerms(query) {
    check(typeof query === "string" && query.trim().length > 0 && query.isWellFormed() && !query.includes("\0") && utf8Length(query) <= 4096, "INVALID_INPUT", "Query must be nonempty text of at most 4096 UTF-8 bytes.");
    const terms = [...new Set(lexicalTerms(query))];
    check(terms.length <= 64, "INVALID_INPUT", "Query exceeds 64 distinct lexical terms.");
    return terms;
}
/**
 * Small, explicit lexical stopword list. This is a deterministic heuristic for the
 * current lexical baseline, not linguistic analysis: it only stops common function
 * words from counting as meaningful query coverage during context prioritization.
 * Ranking/BM25 statistics are unchanged; this only informs eligibility tiers.
 */
export const STOPWORDS = new Set([
    "a", "an", "the", "of", "to", "in", "on", "at", "for", "and", "or", "but", "if", "as", "by", "from", "into", "than", "then", "so", "with",
    "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "done", "have", "has", "had",
    "can", "could", "would", "should", "will", "shall", "may", "might", "must",
    "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them", "my", "your", "his", "its", "our", "their",
    "this", "that", "these", "those", "what", "which", "who", "whom", "whose", "when", "where", "why", "how", "there", "here",
    "please", "kindly", "tell", "let", "just", "about", "again", "some", "any", "not", "no", "yes", "up", "out", "over",
    // Common Chinese function words; lexical heuristic only, aligned with the tokenizer.
    "的", "了", "是", "在", "我", "你", "他", "她", "它", "们", "和", "与", "或", "吗", "呢", "啊", "请", "把", "被", "个", "这", "那", "什么", "怎么", "哪", "吧", "呀",
]);
/** Query/candidate terms that carry topical signal, excluding common stopwords. */
export function meaningfulTerms(terms) {
    return terms.filter(term => !STOPWORDS.has(term));
}
export function matchExpression(terms) {
    return terms.map(term => `"${term.replaceAll('"', '""')}"`).join(" OR ");
}
/** No corpus-global statistics: unrelated scopes cannot alter scores or freshness. */
export function lexicalScore(tokens, query) {
    const terms = tokens.split(" ");
    const requested = query.split(" ");
    const frequencies = new Map();
    for (const term of terms)
        frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
    let matched = 0;
    let frequency = 0;
    for (const term of requested) {
        const count = frequencies.get(term) ?? 0;
        if (count > 0) {
            matched++;
            frequency += Math.log1p(count);
        }
    }
    return (matched / requested.length) * (1 + frequency / requested.length) / (1 + terms.length / 256);
}
export function isBoundary(text, position) {
    if (position === 0 || position === text.length)
        return true;
    const before = text.charCodeAt(position - 1);
    const after = text.charCodeAt(position);
    return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}
export function passages(content) {
    const ranges = [];
    let previous = 0;
    for (const separator of content.matchAll(/\r?\n[ \t]*\r?\n/g)) {
        ranges.push([previous, separator.index]);
        previous = separator.index + separator[0].length;
        // Pathological paragraph counts use bounded contiguous windows instead.
        if (ranges.length >= 1024) {
            ranges.length = 0;
            previous = 0;
            break;
        }
    }
    ranges.push([previous, content.length]);
    const result = [];
    for (const [from, until] of ranges) {
        let start = from;
        while (start < until) {
            while (start < until && /\s/u.test(content[start]))
                start++;
            if (start === until)
                break;
            let end = Math.min(start + MAX_PASSAGE_UNITS, until);
            if (!isBoundary(content, end))
                end--;
            if (end < until) {
                const space = content.lastIndexOf(" ", end - 1);
                if (space > start + MAX_PASSAGE_UNITS / 2)
                    end = space;
            }
            let trimmedEnd = end;
            while (trimmedEnd > start && /\s/u.test(content[trimmedEnd - 1]))
                trimmedEnd--;
            const text = content.slice(start, trimmedEnd);
            const tokens = lexicalTerms(text).join(" ");
            if (tokens.length > 0)
                result.push({ start, end: trimmedEnd, text, tokens });
            start = end;
        }
    }
    return result;
}
