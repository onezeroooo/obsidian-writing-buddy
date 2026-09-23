import { check } from "../errors.js";
import { id, plainObject } from "../validation.js";
import { candidateDimensions } from "./dimensions.js";
export const NORMALIZER_VERSION = "generic-scalar-dimensions-v2";
export const canonicalMention = (value) => value.normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ");
const defaults = { "预算": "budget", "喜欢": "preference", "prefer": "preference", "prefers": "preference", "preference": "preference", "favourite color": "favorite color" };
export function vocabulary(input = {}) {
    plainObject(input, ["subjects", "predicates"]);
    const result = { subjects: {}, predicates: {} };
    for (const field of ["subjects", "predicates"]) {
        const aliases = input[field] ?? {};
        check(aliases !== null && typeof aliases === "object" && Object.getPrototypeOf(aliases) === Object.prototype && Object.keys(aliases).length <= 128, "INVALID_INPUT", "Invalid alias registry.");
        const entries = new Map();
        for (const [alias, target] of Object.entries(aliases)) {
            id(alias);
            id(target);
            const key = canonicalMention(alias);
            const value = canonicalMention(target);
            check(!entries.has(key) || entries.get(key) === value, "INVALID_INPUT", "Ambiguous normalized alias.");
            entries.set(key, value);
        }
        for (const target of entries.values())
            check(!entries.has(target) || entries.get(target) === target, "INVALID_INPUT", "Alias chains and cycles are not supported.");
        result[field] = Object.fromEntries([...entries].sort(([a], [b]) => a.localeCompare(b)));
    }
    return result;
}
export function normalize(raw, index, run, evidence, aliases, method) {
    const ambiguities = [...raw.uncertainty];
    const dimensions = candidateDimensions(raw, evidence, run.metadata);
    const subject = canonicalMention(raw.subject);
    let subjectId = null;
    if (["", "i", "my", "me", "我", "我的"].includes(subject)) {
        if (run.metadata.actorId)
            subjectId = `actor:${run.metadata.actorId}`;
        else
            ambiguities.push("The source has no authenticated speaker.");
    }
    else if (Object.hasOwn(aliases.subjects, subject))
        subjectId = aliases.subjects[subject];
    else if (/^(project|team|service|项目)[: ]/u.test(subject))
        subjectId = subject.replace(/[: ]+/u, ":");
    else
        ambiguities.push("Named entity has no unambiguous identity mapping.");
    const mention = canonicalMention(raw.predicate);
    let predicate = Object.hasOwn(aliases.predicates, mention) ? aliases.predicates[mention] : Object.hasOwn(defaults, mention) ? defaults[mention] : mention;
    let value = canonicalMention(raw.value);
    // Recognized suffixes stay in their own dimensions; raw mentions are unchanged.
    const suffixes = [...dimensions.qualifiers.map(q => canonicalMention(q.raw)), ...(dimensions.temporal ? [canonicalMention(dimensions.temporal.raw)] : [])];
    let stripped = true;
    while (stripped) {
        stripped = false;
        for (const suffix of suffixes)
            if (value.endsWith(" " + suffix)) {
                value = value.slice(0, -suffix.length).trim();
                stripped = true;
            }
    }
    let unit = null;
    const numeric = /^([+-]?(?:\d+(?:\.\d+)?|\.\d+))(?:(k|m|\s*wan|\s*万))?\s*(cny|rmb|yuan|元|usd|dollars?|eur|euros?|kg|g|km|m|cm)?$/u.exec(value);
    if (numeric) {
        const factors = { k: 1000, m: 1000000, wan: 10000, "万": 10000 };
        let number = Number(numeric[1]) * (factors[numeric[2]?.trim() ?? ""] ?? 1);
        const units = { cny: ["CNY", 1], rmb: ["CNY", 1], yuan: ["CNY", 1], "元": ["CNY", 1], usd: ["USD", 1], dollar: ["USD", 1], dollars: ["USD", 1], eur: ["EUR", 1], euro: ["EUR", 1], euros: ["EUR", 1], kg: ["g", 1000], g: ["g", 1], km: ["m", 1000], m: ["m", 1], cm: ["m", 0.01] };
        const conversion = units[numeric[3] ?? ""];
        if (conversion) {
            unit = conversion[0];
            number *= conversion[1];
        }
        if (Number.isFinite(number) && Math.abs(number) <= Number.MAX_SAFE_INTEGER)
            value = number;
        else {
            value = null;
            ambiguities.push("Numeric value is out of range.");
        }
        if (numeric[2] === "m" && !numeric[3])
            ambiguities.push("Attached m is ambiguous between a multiplier and a length unit.");
        if (predicate === "budget" && !unit)
            ambiguities.push("Budget currency is unspecified.");
    }
    else if (["true", "false"].includes(value))
        value = value === "true";
    if (predicate === "budget" && raw.intent !== "retract" && (typeof value !== "number" || !["CNY", "USD", "EUR"].includes(unit ?? "")))
        ambiguities.push("Budget requires an explicit supported currency and numeric amount.");
    if (unit && predicate)
        predicate += `:${unit}`;
    if (dimensions.qualifiers.length)
        ambiguities.push("Qualified facts require a richer slot model.");
    if (dimensions.temporal)
        ambiguities.push("Temporal expression is retained but not applied to current state.");
    if (subjectId && subjectId.length > 256) {
        subjectId = null;
        ambiguities.push("Canonical identity exceeds slot limits.");
    }
    if (predicate.length > 256) {
        predicate = "";
        ambiguities.push("Canonical predicate exceeds slot limits.");
    }
    return { id: `${run.id}:${index}`, raw, dimensions, evidence: { evidenceId: evidence.id, sourceId: evidence.sourceId, sourceVersion: evidence.sourceVersion, contentHash: evidence.contentHash, start: raw.span.start, end: raw.span.end, offsetUnit: "utf16" }, extraction: { method, fingerprint: run.providerFingerprint }, normalization: { version: NORMALIZER_VERSION, subjectId, predicate: predicate || null, value, unit, ambiguities } };
}
