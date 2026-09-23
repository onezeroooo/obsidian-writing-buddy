import { RecantaError, check } from "../errors.js";
import { id, integer, plainObject } from "../validation.js";
import { utf8Length } from "../runtime.js";
import { isBoundary } from "../retrieval/text.js";
export function text(value, max = 4096, allowEmpty = false) {
    check(typeof value === "string" && (allowEmpty || value.trim().length > 0) && value.isWellFormed() && !value.includes("\0") && utf8Length(value) <= max, "INVALID_INPUT", "Invalid or oversized processing text.");
}
export function metadata(value) {
    plainObject(value, ["actorId", "actorType", "authority", "toolOutcome", "derivedFromEvidenceId", "timezone"]);
    check(["person", "assistant", "tool", "document"].includes(value.actorType), "INVALID_INPUT", "Invalid source actor type.");
    if (value.actorId !== undefined)
        id(value.actorId);
    if (value.authority !== undefined)
        check(["approved", "observation"].includes(value.authority), "INVALID_INPUT", "Invalid source authority.");
    if (value.toolOutcome !== undefined)
        check(value.actorType === "tool" && ["attempted", "succeeded", "failed", "unknown"].includes(value.toolOutcome), "INVALID_INPUT", "Tool outcome requires a tool source.");
    if (value.derivedFromEvidenceId !== undefined)
        id(value.derivedFromEvidenceId);
    if (value.timezone !== undefined) {
        id(value.timezone);
        try {
            new Intl.DateTimeFormat("en-US", { timeZone: value.timezone }).format();
        }
        catch {
            check(false, "INVALID_INPUT", "Timezone must be a supported IANA identifier.");
        }
    }
    return { actorType: value.actorType, ...(value.timezone === undefined ? {} : { timezone: value.timezone }), ...(value.actorId === undefined ? {} : { actorId: value.actorId }), ...(value.authority === undefined ? {} : { authority: value.authority }), ...(value.toolOutcome === undefined ? {} : { toolOutcome: value.toolOutcome }), ...(value.derivedFromEvidenceId === undefined ? {} : { derivedFromEvidenceId: value.derivedFromEvidenceId }) };
}
/**
 * A span is the quote; the offsets are derived. A provider that names exact,
 * matching UTF-16 offsets keeps them. One that omits them, or names offsets
 * that do not hold the quote, has the quote located in the source instead:
 * the occurrence nearest the offsets it gave, or the first. Models copy text
 * faithfully and count code units badly; a span that fails only on arithmetic
 * is not a reason to pay for the passage again.
 */
function span(value, content) {
    text(value.quote, 16384);
    const quote = value.quote;
    const exact = typeof value.start === "number" && typeof value.end === "number" && Number.isSafeInteger(value.start) && Number.isSafeInteger(value.end)
        && value.start >= 0 && value.end <= content.length && value.end > value.start && content.slice(value.start, value.end) === quote;
    if (!exact) {
        const hint = typeof value.start === "number" && Number.isSafeInteger(value.start) ? value.start : 0;
        let at = -1;
        for (let found = content.indexOf(quote); found !== -1; found = content.indexOf(quote, found + 1)) {
            if (at === -1 || Math.abs(found - hint) < Math.abs(at - hint))
                at = found;
        }
        check(at !== -1, "INVALID_INPUT", "Extraction quote does not occur in the source.");
        value.start = at;
        value.end = at + quote.length;
    }
    integer(value.start);
    integer(value.end, value.start + 1, content.length);
    check(isBoundary(content, value.start) && isBoundary(content, value.end), "INVALID_INPUT", "Extraction span must lie on UTF-16 boundaries.");
}
function strings(value) {
    check(Array.isArray(value) && value.length <= 16, "INVALID_INPUT", "Expected a bounded text list.");
    for (const item of value)
        text(item, 512);
}
/** One candidate, checked on its own; throws INVALID_INPUT for the first thing wrong with it. */
function validateCandidate(c, content) {
    plainObject(c, ["subject", "predicate", "value", "assertionMode", "intent", "span", "qualifiers", "temporalExpression", "confidence", "uncertainty"]);
    text(c.subject, 256, true);
    text(c.predicate, 256, true);
    text(c.value, 4096, true);
    check(["assertion", "proposal", "hypothesis", "quotation", "negation"].includes(String(c.assertionMode)), "INVALID_INPUT", "Invalid source assertion mode.");
    check(["assert", "correct", "retract"].includes(String(c.intent)), "INVALID_INPUT", "Invalid candidate intent.");
    check(c.intent === "correct" || c.predicate.trim().length > 0, "INVALID_INPUT", "Only explicit corrections may omit a predicate.");
    check(c.intent === "retract" || c.value.trim().length > 0, "INVALID_INPUT", "An assertion needs a value.");
    plainObject(c.span, ["start", "end", "quote"]);
    span(c.span, content);
    const quote = String(c.span.quote).normalize("NFKC").toLowerCase();
    for (const mention of [c.subject, c.predicate, c.value])
        check(quote.includes(mention.normalize("NFKC").toLowerCase()), "INVALID_INPUT", "Raw mentions must occur inside their evidence span.");
    strings(c.qualifiers);
    strings(c.uncertainty);
    for (const qualifier of c.qualifiers)
        check(quote.includes(qualifier.normalize("NFKC").toLowerCase()), "INVALID_INPUT", "Qualifier must occur in the evidence span.");
    if (c.temporalExpression !== null) {
        text(c.temporalExpression, 512);
        check(quote.includes(c.temporalExpression.normalize("NFKC").toLowerCase()), "INVALID_INPUT", "Temporal expression must occur in its evidence span.");
    }
    check(c.confidence === null || (typeof c.confidence === "number" && Number.isFinite(c.confidence) && c.confidence >= 0 && c.confidence <= 1), "INVALID_INPUT", "Confidence must be unknown or between zero and one.");
}
/**
 * The shape of the whole answer is the provider's to get right; one
 * candidate is not. A candidate that fails its own checks — a mention the
 * model resolved instead of copying, a field it invented, a quote it
 * altered — is set aside as a gap carrying the reason (when its quote is in
 * the source) and the rest of the passage is kept: a slip in one of thirty
 * candidates is not a reason to pay for the passage again. Candidates past
 * the limit are set aside the same way. `rejected` counts them for the host.
 */
export function validateOutput(input, content, maxBytes) {
    plainObject(input, ["candidates", "unresolved"]);
    // A provider may report only what it extracted; the engine finds the uncovered regions itself (`completeCoverage`).
    if (input.unresolved === undefined)
        input.unresolved = [];
    check(utf8Length(JSON.stringify(input)) <= maxBytes, "INVALID_INPUT", "Provider output exceeds maxOutputBytes.");
    check(Array.isArray(input.candidates) && Array.isArray(input.unresolved) && input.unresolved.length <= 32, "INVALID_INPUT", "Provider output exceeds candidate limits.");
    const kept = [];
    const rejected = [];
    for (const candidate of input.candidates) {
        try {
            validateCandidate(candidate, content);
            if (kept.length < 32)
                kept.push(candidate);
            else
                rejected.push({ candidate, reason: "Beyond the candidate limit for one passage." });
        }
        catch (error) {
            if (!(error instanceof RecantaError && error.code === "INVALID_INPUT"))
                throw error;
            rejected.push({ candidate, reason: error.message });
        }
    }
    input.candidates = kept;
    for (const item of rejected) {
        const raw = item.candidate;
        if (!raw || typeof raw !== "object" || !raw.span || typeof raw.span !== "object" || typeof raw.span.quote !== "string" || input.unresolved.length >= 32)
            continue;
        const located = { start: raw.span.start, end: raw.span.end, quote: raw.span.quote };
        try {
            span(located, content);
        }
        catch {
            continue;
        }
        input.unresolved.push({ start: located.start, end: located.end, quote: located.quote, reason: item.reason });
    }
    for (const gap of input.unresolved) {
        plainObject(gap, ["start", "end", "quote", "reason"]);
        span(gap, content);
        text(gap.reason, 512);
    }
    const output = structuredClone(input);
    output.rejected = rejected.length;
    return output;
}
/** Every meaningful source region is either a candidate or an explicit gap. */
export function completeCoverage(output, content) {
    const intervals = [...output.candidates.map(candidate => candidate.span), ...output.unresolved]
        .map(span => ({ start: span.start, end: span.end })).sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    for (const interval of intervals) {
        const last = merged.at(-1);
        if (last && interval.start <= last.end)
            last.end = Math.max(last.end, interval.end);
        else
            merged.push({ ...interval });
    }
    const gaps = [];
    let uncoveredRegions = 0;
    const addGap = (start, end) => {
        if (!/[\p{L}\p{N}]/u.test(content.slice(start, end)))
            return;
        uncoveredRegions++;
        let cursor = start;
        while (cursor < end && gaps.length < 32) {
            let low = cursor + 1;
            let high = end;
            let best = cursor;
            while (low <= high) {
                const middle = Math.floor((low + high) / 2);
                const boundary = isBoundary(content, middle) ? middle : middle - 1;
                if (boundary > cursor && utf8Length(content.slice(cursor, boundary)) <= 16384) {
                    best = boundary;
                    low = middle + 1;
                }
                else
                    high = middle - 1;
            }
            check(best > cursor, "INVALID_INPUT", "Unable to represent provider coverage gap.");
            gaps.push({ start: cursor, end: best, quote: content.slice(cursor, best), reason: "Provider omitted a meaningful source region." });
            cursor = best;
        }
    };
    let position = 0;
    for (const interval of [...merged, { start: content.length, end: content.length }]) {
        addGap(position, interval.start);
        position = Math.max(position, interval.end);
    }
    output.coverage = { complete: uncoveredRegions === 0, uncoveredRegions, detailedRegions: gaps.length };
    output.unresolved.push(...gaps.slice(0, Math.max(0, 32 - output.unresolved.length)));
    return output;
}
export function usage(value) {
    plainObject(value, ["inputTokens", "outputTokens", "costUsd"]);
    integer(value.inputTokens);
    integer(value.outputTokens);
    if (value.costUsd !== undefined)
        check(typeof value.costUsd === "number" && Number.isFinite(value.costUsd) && value.costUsd >= 0, "INVALID_INPUT", "Invalid provider cost.");
    return { ...value };
}
