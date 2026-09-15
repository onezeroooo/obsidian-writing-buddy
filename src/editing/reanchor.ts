/**
 * Finding a passage again after it has moved.
 *
 * The stale guard is deliberately absolute: apply only when the captured range
 * still contains exactly the captured text. That is the right rule, and it stays
 * — but on its own it refuses too early. Typing one word in an earlier paragraph
 * shifts every later line, and the writer then loses a rewrite they were about
 * to accept, for a reason that has nothing to do with the passage itself.
 *
 * So before refusing, look for the passage where it went. The rules here are the
 * ones that make that safe rather than convenient:
 *
 *   - **Exact text only.** The search is for the captured string, byte for byte.
 *     Nothing fuzzy, nothing normalised, no "closest match".
 *   - **Unique or nothing.** One occurrence re-anchors. Several are
 *     disambiguated *only* by the prose that was recorded around the original —
 *     and only if exactly one candidate matches it. Anything still ambiguous is
 *     refused.
 *   - **Never a guess.** Applying a rewrite to the wrong paragraph of a
 *     manuscript is a silent corruption the writer may not notice for days. A
 *     refusal costs them one re-selection.
 */

import type { DocPosition, SelectionAttachment } from "../types";
import type { EditorLike } from "./editor";

/** What was around the passage when it was captured, for disambiguation. */
export interface AnchorHints {
	/** Text immediately before the selection when it was captured. */
	before?: string;
	/** Text immediately after it. */
	after?: string;
}

export type ReanchorResult =
	| { ok: true; from: DocPosition; to: DocPosition }
	| { ok: false; reason: "not-found" | "ambiguous" };

/** How much recorded context is compared when several occurrences match. */
export const CONTEXT_WINDOW = 120;

/**
 * Locate the captured passage in the current buffer.
 *
 * Returns the range it now occupies, or a reason it could not be established
 * safely. The caller re-verifies with the stale guard before writing anything,
 * so a wrong answer here still cannot reach the manuscript — but there should
 * not be one.
 */
export function reanchorSelection(
	editor: EditorLike,
	attachment: SelectionAttachment,
	hints: AnchorHints = {},
): ReanchorResult {
	const needle = attachment.text;
	if (needle.length === 0) return { ok: false, reason: "not-found" };

	const text = editor.getValue();
	const found = occurrences(text, needle);
	if (found.length === 0) return { ok: false, reason: "not-found" };

	const at = found.length === 1 ? found[0] : disambiguate(text, found, needle.length, hints);
	if (at === null) return { ok: false, reason: "ambiguous" };

	const from = positionAt(text, at);
	return { ok: true, from, to: positionAt(text, at + needle.length) };
}

/**
 * Pick the occurrence whose surroundings match what was recorded.
 *
 * Requires a single best match strictly better than every other. Two paragraphs
 * that are identical *and* identically surrounded are genuinely
 * indistinguishable, and the honest answer there is to refuse.
 */
function disambiguate(
	text: string,
	found: number[],
	length: number,
	hints: AnchorHints,
): number | null {
	const before = tail(hints.before ?? "", CONTEXT_WINDOW);
	const after = head(hints.after ?? "", CONTEXT_WINDOW);
	if (before.length === 0 && after.length === 0) return null;

	let best: { at: number; score: number } | null = null;
	let tied = false;

	for (const at of found) {
		const score =
			sharedSuffix(text.slice(Math.max(0, at - CONTEXT_WINDOW), at), before) +
			sharedPrefix(text.slice(at + length, at + length + CONTEXT_WINDOW), after);

		if (best === null || score > best.score) {
			best = { at, score };
			tied = false;
		} else if (score === best.score) {
			tied = true;
		}
	}

	if (!best || tied || best.score === 0) return null;
	return best.at;
}

/** Every index at which `needle` occurs, without overlapping itself. */
function occurrences(haystack: string, needle: string): number[] {
	const found: number[] = [];
	for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
		found.push(at);
	}
	return found;
}

/** Line/character position of a UTF-16 offset, counting CR, LF and CRLF. */
export function positionAt(text: string, offset: number): DocPosition {
	const upTo = text.slice(0, offset);
	const lines = upTo.split(/\r\n|\n|\r/);
	return { line: lines.length - 1, ch: lines[lines.length - 1].length };
}

function tail(text: string, limit: number): string {
	return text.length <= limit ? text : text.slice(text.length - limit);
}

function head(text: string, limit: number): string {
	return text.length <= limit ? text : text.slice(0, limit);
}

/** How many characters two strings share, reading backwards from the end. */
function sharedSuffix(a: string, b: string): number {
	let count = 0;
	while (count < a.length && count < b.length && a[a.length - 1 - count] === b[b.length - 1 - count]) {
		count += 1;
	}
	return count;
}

/** How many characters two strings share, reading forwards from the start. */
function sharedPrefix(a: string, b: string): number {
	let count = 0;
	while (count < a.length && count < b.length && a[count] === b[count]) count += 1;
	return count;
}

// ---------------------------------------------------------------------------
// Navigating to a passage that has since been edited
// ---------------------------------------------------------------------------

/**
 * How well a passage could be found again.
 *
 * Navigation and applying deliberately use **different rules**, and the reason
 * is the cost of being wrong. Writing a replacement into the wrong paragraph is
 * a silent corruption a writer may not notice for days, so `reanchorSelection`
 * insists on the whole passage, verbatim and unique. Taking someone to the wrong
 * paragraph costs them a glance, so navigation can keep trying — as long as it
 * says which of these it managed.
 */
export type PassageLocation =
	| { kind: "exact"; from: DocPosition; to: DocPosition }
	| { kind: "moved"; from: DocPosition; to: DocPosition }
	/** Only part of the passage survives; that part is what gets selected. */
	| { kind: "partial"; from: DocPosition; to: DocPosition; matched: number; of: number }
	/** Nothing of the text survives, but its section heading does. */
	| { kind: "section"; from: DocPosition; to: DocPosition; heading: string }
	| { kind: "lost" };

/**
 * The shortest fragment worth selecting.
 *
 * Below this a "match" is a common phrase — `她说` occurs on every page of a
 * novel — and landing on one is worse than admitting the passage is gone.
 */
export const MIN_PARTIAL_CHARS = 8;

/** And it has to be a real remnant of the passage, not an incidental scrap. */
export const MIN_PARTIAL_RATIO = 0.25;

export interface LocateOptions extends AnchorHints {
	/** The section the passage belongs to, for the last fallback. */
	heading?: string | null;
}

/**
 * Find a passage in the current text, trying successively weaker evidence.
 *
 * In order: the recorded range still holds it; the whole passage occurs
 * elsewhere and can be pinned down; the longest surviving run of it can be
 * pinned down; its heading can. Each step is exact-substring matching — nothing
 * here is fuzzy, and nothing is selected that is not genuinely in the file.
 */
export function locatePassage(
	text: string,
	passage: string,
	range: { from: DocPosition; to: DocPosition },
	options: LocateOptions = {},
): PassageLocation {
	if (passage.length === 0) return { kind: "lost" };

	// 1. Still exactly where it was.
	const start = offsetAt(text, range.from);
	const end = offsetAt(text, range.to);
	if (start !== null && end !== null && text.slice(start, end) === passage) {
		return { kind: "exact", from: range.from, to: range.to };
	}

	// 2. Moved, but intact.
	const whole = occurrences(text, passage);
	const movedTo =
		whole.length === 1 ? whole[0] : whole.length > 1 ? disambiguate(text, whole, passage.length, options) : null;
	if (movedTo !== null) {
		return { kind: "moved", from: positionAt(text, movedTo), to: positionAt(text, movedTo + passage.length) };
	}

	// 3. Edited, but a substantial run of it survives.
	const remnant = longestUniqueRun(text, passage);
	if (remnant) {
		return {
			kind: "partial",
			from: positionAt(text, remnant.at),
			to: positionAt(text, remnant.at + remnant.length),
			matched: remnant.length,
			of: passage.length,
		};
	}

	// 4. Gone, but the section it was in is still there.
	const heading = options.heading?.trim();
	if (heading) {
		const line = findHeadingLine(text, heading);
		if (line !== null) {
			return {
				kind: "section",
				from: positionAt(text, line.at),
				to: positionAt(text, line.at + line.length),
				heading,
			};
		}
	}

	return { kind: "lost" };
}

/**
 * The longest prefix or suffix of the passage that occurs exactly once.
 *
 * Occurrence count falls as the fragment grows, so the longest fragment that
 * occurs at all is also the least ambiguous one — and it is found by binary
 * search rather than by trying every length. Both ends are tried because an edit
 * is as likely to be at the start of a paragraph as at the end.
 */
function longestUniqueRun(text: string, passage: string): { at: number; length: number } | null {
	const floor = Math.max(MIN_PARTIAL_CHARS, Math.ceil(passage.length * MIN_PARTIAL_RATIO));
	if (passage.length < floor) return null;

	const best = [longestMatching(text, passage, "prefix", floor), longestMatching(text, passage, "suffix", floor)]
		.filter((candidate): candidate is { at: number; length: number } => candidate !== null)
		.sort((a, b) => b.length - a.length)[0];

	return best ?? null;
}

function longestMatching(
	text: string,
	passage: string,
	end: "prefix" | "suffix",
	floor: number,
): { at: number; length: number } | null {
	const fragment = (length: number): string =>
		end === "prefix" ? passage.slice(0, length) : passage.slice(passage.length - length);

	// Largest length whose fragment still appears somewhere.
	let low = floor;
	let high = passage.length;
	let found = -1;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		if (text.includes(fragment(middle))) {
			found = middle;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}
	if (found < floor) return null;

	// It has to be the only one, or it is a guess.
	const hits = occurrences(text, fragment(found));
	if (hits.length !== 1) return null;
	return { at: hits[0], length: found };
}

/** Offset of a line/character position, or null when it is out of bounds. */
function offsetAt(text: string, position: DocPosition): number | null {
	const lines = text.split(/\r\n|\n|\r/);
	if (position.line < 0 || position.line >= lines.length) return null;
	if (position.ch < 0 || position.ch > lines[position.line].length) return null;

	// Reconstructed from the same split, so mixed line endings stay consistent.
	let offset = 0;
	for (let index = 0; index < position.line; index += 1) {
		offset = text.indexOf(lines[index], offset) + lines[index].length;
		const breakLength = text.startsWith("\r\n", offset) ? 2 : 1;
		offset += breakLength;
	}
	return offset + position.ch;
}

/** The line a heading sits on, matched exactly and only when unique. */
function findHeadingLine(text: string, heading: string): { at: number; length: number } | null {
	// `[ \t]`, not `\s`: in multiline mode `\s` matches the newline too, so the
	// match began on the blank line *above* the heading and pointed one line
	// short of it.
	const pattern = new RegExp(`^[ \\t]{0,3}#{1,6}[ \\t]+${escapeRegExp(heading)}[ \\t]*$`, "gm");
	const matches = [...text.matchAll(pattern)];
	if (matches.length !== 1) return null;
	const match = matches[0];
	return { at: match.index ?? 0, length: match[0].length };
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
