import { check } from "../errors.js";
import { utf8Length } from "../runtime.js";
/** Whole passages only; required facts and framing are never silently truncated. */
export function packContext(body, candidates, maxBytes, snapshot) {
    body.omittedSources = candidates.length;
    let text = JSON.stringify(body);
    check(utf8Length(text) <= maxBytes, "INSUFFICIENT_BUDGET", "Required fact state and context framing exceed maxBytes.");
    for (const candidate of candidates) {
        body.sources.push(candidate);
        body.omittedSources--;
        const next = JSON.stringify(body);
        if (utf8Length(next) <= maxBytes)
            text = next;
        else {
            body.sources.pop();
            body.omittedSources++;
        }
    }
    return { text, bytes: utf8Length(text), snapshot };
}
