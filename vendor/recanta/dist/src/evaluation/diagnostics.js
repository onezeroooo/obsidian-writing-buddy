import { check } from "../errors.js";
import { id, integer } from "../validation.js";
function spanCovered(spans, gold) {
    let covered = gold.start;
    for (const span of spans.filter(s => s.sourceId === gold.sourceId).sort((a, b) => a.start - b.start)) {
        if (span.start > covered)
            break;
        if (span.end > covered)
            covered = span.end;
        if (covered >= gold.end)
            return true;
    }
    return false;
}
export function retrievalDiagnostics(gold, candidates, returned) {
    const empty = { answerTurnRecall: null, answerSpanRecall: null, candidateTurnRecall: null, candidateSpanRecall: null, missedTurns: [], missedSpans: [] };
    if (gold === null || !gold.length)
        return empty;
    check(gold.length <= 1000, "INVALID_INPUT", "Too many diagnostic annotations.");
    const ids = new Set();
    for (const item of gold) {
        id(item.sourceId);
        check(!ids.has(item.sourceId), "INVALID_INPUT", "Duplicate gold turn.");
        ids.add(item.sourceId);
        check(item.spans === undefined || Array.isArray(item.spans), "INVALID_INPUT", "Invalid gold spans.");
        for (const span of item.spans ?? []) {
            integer(span.start);
            integer(span.end, span.start + 1);
        }
    }
    const turns = [...ids];
    const spans = gold.flatMap(item => (item.spans ?? []).map(span => ({ sourceId: item.sourceId, ...span })));
    const hitTurns = (citations) => turns.filter(id => citations.some(c => c.sourceId === id));
    const hitSpans = (citations) => spans.filter(span => spanCovered(citations, span));
    return { answerTurnRecall: hitTurns(returned).length / turns.length, candidateTurnRecall: hitTurns(candidates).length / turns.length,
        answerSpanRecall: spans.length ? hitSpans(returned).length / spans.length : null,
        candidateSpanRecall: spans.length ? hitSpans(candidates).length / spans.length : null,
        missedTurns: turns.filter(id => !returned.some(c => c.sourceId === id)), missedSpans: spans.filter(span => !spanCovered(returned, span)) };
}
/** Measures retrieval and final selection separately; labels remain evaluation-only. */
export function contextPipelineDiagnostics(input) {
    const recall = retrievalDiagnostics(input.gold, input.candidates, input.returned);
    integer(input.contextBytes);
    integer(input.contextTokens);
    if (input.latencyMs !== undefined)
        check(Number.isFinite(input.latencyMs) && input.latencyMs >= 0, "INVALID_INPUT", "Invalid context latency.");
    const identity = (citation) => JSON.stringify([citation.evidenceId, citation.sourceId, citation.sourceVersion, citation.contentHash, citation.start, citation.end, citation.offsetUnit]);
    const candidateIds = new Set(input.candidates.map(identity));
    const returnedIds = new Set(input.returned.map(identity));
    const validIds = new Set(input.validCitations.map(identity));
    const survived = [...candidateIds].filter(value => returnedIds.has(value)).length;
    const goldIds = new Set((input.gold ?? []).map(item => item.sourceId));
    const relevantCandidates = input.candidates.filter(item => goldIds.has(item.sourceId));
    const relevantReturned = relevantCandidates.filter(item => returnedIds.has(identity(item)));
    const relevantContext = input.returned.filter(item => goldIds.has(item.sourceId));
    const ratio = (part, whole) => whole ? part / whole : null;
    return { ...recall, candidateToContextSurvival: ratio(survived, candidateIds.size), relevantCandidateSurvival: ratio(relevantReturned.length, relevantCandidates.length),
        contextPrecision: input.gold === null ? null : ratio(relevantContext.length, input.returned.length),
        citationCorrectness: input.returned.every(item => validIds.has(identity(item))) ? 1 : input.returned.filter(item => validIds.has(identity(item))).length / input.returned.length,
        requiredFactRetention: input.requiredFacts ? ratio(input.requiredFacts.retained, input.requiredFacts.expected) : null,
        conflictRetention: input.conflicts ? ratio(input.conflicts.retained, input.conflicts.expected) : null, contextBytes: input.contextBytes, contextTokens: input.contextTokens, tokenAccounting: input.tokenAccounting ?? "estimated",
        latencyMs: input.latencyMs ?? null, providerUsage: input.providerUsage ?? null };
}
/** Exact match only; no inferred semantic judging and no credit for missing output. */
export function answerAccuracy(expected, answer) {
    if (expected === null || answer === undefined)
        return { evaluated: false, exactMatch: null };
    check(expected.length > 0 && expected.every(item => typeof item === "string") && typeof answer === "string", "INVALID_INPUT", "Invalid answer evaluation input.");
    const normalize = (text) => text.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ");
    return { evaluated: true, exactMatch: expected.some(gold => normalize(gold) === normalize(answer)) };
}
