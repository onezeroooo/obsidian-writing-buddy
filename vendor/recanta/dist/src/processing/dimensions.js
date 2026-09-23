const temporalPattern = /\b(?:currently|today|tomorrow|yesterday|next month|last month|before(?: \d{4}-\d{2}-\d{2})?|after(?: \d{4}-\d{2}-\d{2})?|\d{4}-\d{2}-\d{2})\b|下个月|上个月|明天|昨天|目前|今天/iu;
export function candidateDimensions(raw, evidence, metadata) {
    const quote = raw.span.quote;
    const mentioned = new Set([...raw.qualifiers, ...Array.from(quote.matchAll(/\b(?:for|in) (?:project [\p{L}\p{N}_-]+|production|staging|development|US|UK|EU|CN|v\d+)\b/giu), m => m[0])]);
    const qualifiers = [...mentioned].map(value => {
        const project = /^(?:for|in) project (.+)$/iu.exec(value);
        const environment = /^(?:for|in) (production|staging|development)$/iu.exec(value);
        const region = /^(?:for|in) (US|UK|EU|CN)$/iu.exec(value);
        const version = /^(?:for|in) (v\d+)$/iu.exec(value);
        const offset = quote.toLowerCase().indexOf(value.toLowerCase());
        return { raw: value, kind: project ? "project" : environment ? "environment" : region ? "region" : version ? "version" : "unknown", value: (project?.[1] ?? environment?.[1] ?? region?.[1] ?? version?.[1] ?? value).normalize("NFKC").toLowerCase(), start: offset < 0 ? null : raw.span.start + offset, end: offset < 0 ? null : raw.span.start + offset + value.length };
    });
    const expression = raw.temporalExpression ?? temporalPattern.exec(quote)?.[0] ?? null;
    if (!expression)
        return { version: "candidate-dimensions-v1", qualifiers, temporal: null };
    const lower = expression.toLowerCase();
    const temporal = { raw: expression, kind: "unknown", anchor: evidence.occurredAt, timezone: metadata.timezone ?? null, interval: null, resolution: "unresolved", reason: "Unsupported temporal expression; no current-state update." };
    const format = (date) => date.toISOString().slice(0, 10);
    const exact = /^\d{4}-\d{2}-\d{2}$/u.test(lower);
    if (exact) {
        const date = new Date(lower + "T00:00:00.000Z");
        temporal.kind = "absolute";
        if (Number.isFinite(date.getTime()) && format(date) === lower) {
            const next = new Date(date);
            next.setUTCDate(next.getUTCDate() + 1);
            temporal.interval = { startDate: lower, endDateExclusive: format(next) };
            temporal.resolution = "anchored";
            temporal.reason = "Explicit calendar date; validity is not scheduled.";
        }
    }
    else if (/^before\b/iu.test(lower))
        temporal.kind = "before";
    else if (/^after\b/iu.test(lower))
        temporal.kind = "after";
    else if (/^(currently|目前)$/u.test(lower)) {
        temporal.kind = "current";
        temporal.resolution = evidence.occurredAt ? "anchored" : "unresolved";
        temporal.reason = "Source-relative current statement; no future freshness guarantee.";
    }
    else if (/^(today|tomorrow|yesterday|next month|last month|下个月|上个月|明天|昨天|今天)$/u.test(lower)) {
        temporal.kind = "relative";
        if (!evidence.occurredAt || !metadata.timezone)
            temporal.reason = "Relative dates require both source timestamp and explicit timezone.";
        else {
            const parts = new Intl.DateTimeFormat("en-US", { timeZone: metadata.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(evidence.occurredAt));
            const get = (type) => Number(parts.find(p => p.type === type).value);
            const start = new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
            const month = /month|个月/u.test(lower);
            const delta = /tomorrow|next|下个月|明天/u.test(lower) ? 1 : /yesterday|last|上个月|昨天/u.test(lower) ? -1 : 0;
            if (month) {
                start.setUTCDate(1);
                start.setUTCMonth(start.getUTCMonth() + delta);
            }
            else
                start.setUTCDate(start.getUTCDate() + delta);
            const end = new Date(start);
            if (month)
                end.setUTCMonth(end.getUTCMonth() + 1);
            else
                end.setUTCDate(end.getUTCDate() + 1);
            temporal.interval = { startDate: format(start), endDateExclusive: format(end) };
            temporal.resolution = "anchored";
            temporal.reason = "Calendar interval resolved in source timezone; not applied to scalar memory.";
        }
    }
    return { version: "candidate-dimensions-v1", qualifiers, temporal };
}
