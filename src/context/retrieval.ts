/**
 * Generic lexical helpers used by the Agent-governed ResearchRetriever.
 * This module does not decide when cross-file research is needed or inject
 * task-specific sources into an ordinary turn.
 */

/**
 * Extract search terms from Chinese and Latin text.
 *
 * Han text has no spaces, so character bigrams stand in for words: they catch
 * names and two-character terms, which is most of what matters for locating a
 * character sheet or a chapter. Latin runs are taken whole.
 */
export function extractTerms(text: string, limit = 40): string[] {
	const terms = new Set<string>();
	for (const word of text.toLowerCase().match(/[\p{L}\p{N}_]{2,}/gu) ?? []) {
		// Skip pure-Han matches here; they are handled as bigrams below.
		if (!/^[\p{Script=Han}]+$/u.test(word)) terms.add(word);
	}

	// Keep each run separate. Joining them manufactured terms across sentence,
	// paragraph and input-channel boundaries ("林昭\n雾港" yielded "昭雾").
	for (const run of text.match(/[\p{Script=Han}]+/gu) ?? []) {
		const han = Array.from(run);
		for (let index = 0; index + 1 < han.length; index += 1) {
			terms.add(han[index] + han[index + 1]);
			if (terms.size >= limit * 4) break;
		}
		if (terms.size >= limit * 4) break;
	}

	return [...terms].slice(0, limit);
}

export interface RelevantPassage {
	text: string;
	truncated: boolean;
}

/**
 * Select the matching Markdown section and, when necessary, a window around
 * its densest hit. The optional tail mode remains a generic passage operation.
 */
export function extractRelevantPassage(
	text: string,
	terms: string[],
	limit: number,
	mode: "match" | "tail" = "match",
): RelevantPassage {
	const size = Array.from(text).length;
	if (size <= limit) return { text, truncated: false };
	if (limit <= 0) return { text: "", truncated: size > 0 };
	if (mode === "tail") return { text: tailPassage(text, limit), truncated: true };

	const sections = markdownSections(text);
	let best = sections[0] ?? { headingLine: null, body: text, full: text };
	let bestHits = -1;
	for (const section of sections) {
		const haystack = section.full.toLowerCase();
		const hits = terms.reduce((sum, term) => sum + countTerm(haystack, term), 0);
		if (hits > bestHits) {
			best = section;
			bestHits = hits;
		}
	}
	if (Array.from(best.full).length <= limit) return { text: best.full, truncated: true };

	const heading = best.headingLine ? `${best.headingLine}\n` : "";
	if (Array.from(heading).length >= limit) {
		const offset = bestHitOffset(best.body, terms, limit);
		return {
			text: offset === null ? headPassage(best.full, limit) : windowAroundUtf16Offset(best.body, offset, limit),
			truncated: true,
		};
	}
	const bodyLimit = Math.max(1, limit - Array.from(heading).length);
	const offset = bestHitOffset(best.body, terms, bodyLimit);
	const body = offset === null
		? headPassage(best.body, bodyLimit)
		: windowAroundUtf16Offset(best.body, offset, bodyLimit);
	return { text: `${heading}${body}`.slice(0), truncated: true };
}

interface MarkdownSection {
	headingLine: string | null;
	body: string;
	full: string;
}

function markdownSections(text: string): MarkdownSection[] {
	const matches = [...text.matchAll(/^\s{0,3}#{1,6}\s+.*\S\s*$/gm)];
	if (matches.length === 0) return [{ headingLine: null, body: text, full: text }];
	const sections: MarkdownSection[] = [];
	if ((matches[0].index ?? 0) > 0) {
		const body = text.slice(0, matches[0].index);
		if (body.trim()) sections.push({ headingLine: null, body, full: body });
	}
	for (let index = 0; index < matches.length; index += 1) {
		const start = matches[index].index ?? 0;
		const end = index + 1 < matches.length ? matches[index + 1].index ?? text.length : text.length;
		const full = text.slice(start, end).trim();
		const newline = full.indexOf("\n");
		const headingLine = newline === -1 ? full : full.slice(0, newline);
		const body = newline === -1 ? "" : full.slice(newline + 1);
		sections.push({ headingLine, body, full });
	}
	return sections;
}

/**
 * A preview window centred on where the terms actually are.
 *
 * A passage is chosen for the density of its matches and can run several
 * thousand characters; a preview of it was cut from the head. Measured against
 * a real manuscript, that lost the query term from four of six previews for a
 * character who appears twenty-odd times in each of those very passages — so
 * the model, which decides what to read from previews alone, read the two it
 * could see and reported the character absent.
 *
 * Selection and presentation now use one standard: whatever made this passage
 * win is what the preview shows. The passage is unchanged — this only moves
 * the window that represents it.
 */
export function previewAroundMatch(text: string, terms: readonly string[], limit: number): string {
	const chars = Array.from(text);
	if (limit <= 0) return "";
	if (chars.length <= limit) return text;
	const offset = bestHitOffset(text, [...terms], limit);
	// No term occurs here at all: the head is as good a window as any, and is
	// what a reader would see if they opened the passage themselves.
	if (offset === null) return headPassage(text, limit);
	return windowAroundUtf16Offset(text, offset, limit);
}

function bestHitOffset(text: string, terms: string[], window: number): number | null {
	const lower = text.toLowerCase();
	const offsets: number[] = [];
	for (const term of terms) {
		let at = lower.indexOf(term);
		while (at !== -1 && offsets.length < 200) {
			offsets.push(at);
			at = lower.indexOf(term, at + Math.max(1, term.length));
		}
		if (offsets.length >= 200) break;
	}
	let best: { offset: number; score: number } | null = null;
	for (const offset of offsets) {
		const excerpt = windowAroundUtf16Offset(text, offset, window).toLowerCase();
		const score = terms.reduce((sum, term) => sum + countTerm(excerpt, term), 0);
		if (!best || score > best.score || (score === best.score && offset < best.offset)) best = { offset, score };
	}
	return best?.offset ?? null;
}

function headPassage(text: string, limit: number): string {
	const chars = Array.from(text);
	if (chars.length <= limit) return text;
	return `${chars.slice(0, Math.max(0, limit - 1)).join("")}…`;
}

function tailPassage(text: string, limit: number): string {
	const chars = Array.from(text);
	if (chars.length <= limit) return text;
	return `…${chars.slice(chars.length - Math.max(0, limit - 1)).join("")}`;
}

function windowAroundUtf16Offset(text: string, offset: number, limit: number): string {
	const chars = Array.from(text);
	if (limit <= 0) return "";
	if (chars.length <= limit) return text;
	const point = Array.from(text.slice(0, Math.max(0, Math.min(offset, text.length)))).length;
	if (limit <= 2) {
		const start = Math.max(0, Math.min(chars.length - limit, point - Math.floor(limit / 2)));
		return chars.slice(start, start + limit).join("");
	}
	const contentLimit = Math.max(1, limit - 2);
	const before = Math.floor(contentLimit / 2);
	let start = Math.max(0, point - before);
	let end = Math.min(chars.length, start + contentLimit);
	start = Math.max(0, end - contentLimit);
	return `${start > 0 ? "…" : ""}${chars.slice(start, end).join("")}${end < chars.length ? "…" : ""}`;
}

/** Count non-overlapping occurrences, capped so one term cannot dominate. */
function countTerm(haystack: string, term: string, cap = 5): number {
	if (term.length === 0) return 0;
	let count = 0;
	let at = haystack.indexOf(term);
	while (at !== -1 && count < cap) {
		count += 1;
		at = haystack.indexOf(term, at + term.length);
	}
	return count;
}
