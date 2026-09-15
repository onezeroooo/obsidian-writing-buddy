/**
 * Text helpers that are correct for Chinese prose.
 *
 * The rule throughout WritingBuddy: count and slice by code point, never by
 * UTF-16 unit, so that one Han character is one 字.
 */

/** Code-point length. `charCount("你好")` is 2, not 4. */
export function countChars(text: string): number {
	let count = 0;
	for (const _ of text) {
		void _;
		count += 1;
	}
	return count;
}

/** Truncate by code point, appending an ellipsis when the text was cut. */
export function truncateChars(text: string, limit: number): string {
	if (limit <= 0) return "";
	const chars = Array.from(text);
	if (chars.length <= limit) return text;
	return `${chars.slice(0, limit).join("")}…`;
}

/**
 * A single-line preview of a selection. Interior newlines become a visible
 * separator so the writer can tell a multi-paragraph selection at a glance.
 */
export function previewOf(text: string, limit = 60): string {
	const collapsed = text.replace(/\s*\r?\n\s*/g, " ⏎ ").replace(/[ \t]+/g, " ").trim();
	return truncateChars(collapsed, limit);
}

/** Basename of a vault-relative path. */
export function baseName(path: string): string {
	const parts = path.split("/");
	return parts[parts.length - 1] || path;
}

/**
 * How much of the selected prose a citation chip shows.
 *
 * The chip's job is to say *this message was about this prose*, so the visible
 * text has to be the prose itself — a filename says only that something was
 * attached. Sixteen characters is about one clause of Chinese, enough to
 * recognise a passage without the chip growing into a card.
 */
export const CITATION_PREVIEW_LIMIT = 16;

/**
 * A one-line, fixed-length excerpt of a selection, for a citation chip.
 *
 * Leading punctuation and quote marks are dropped so the excerpt starts on a
 * word: a chip reading `「」，他推门…` wastes its very limited space.
 */
export function citationPreview(text: string, limit = CITATION_PREVIEW_LIMIT): string {
	const flattened = text.replace(/\s+/g, " ").trim();
	const trimmed = flattened.replace(/^[\s#>*_`~—–\-·。，、；：！？…「」『』“”"'‘’（）()[\]]+/u, "");
	const body = trimmed.length > 0 ? trimmed : flattened;
	return truncateChars(body, limit);
}

/**
 * Upper bound on how much of a selection a hover preview will show.
 *
 * A writer can attach a whole scene, and a hover panel containing several
 * thousand characters is unreadable and taller than the window. A thousand
 * characters is roughly a page of Chinese prose — enough to recognise the
 * passage, which is all the preview is for.
 */
export const HOVER_PREVIEW_LIMIT = 1000;

export interface HoverPreview {
	text: string;
	truncated: boolean;
	/** Characters not shown, so the UI can say how much was cut. */
	omitted: number;
}

/**
 * Clip a selection for a hover preview, counting by code point so a limit of
 * 1000 means 1000 Chinese characters rather than 500.
 */
export function hoverPreview(text: string, limit = HOVER_PREVIEW_LIMIT): HoverPreview {
	const characters = Array.from(text);
	if (characters.length <= limit) {
		return { text, truncated: false, omitted: 0 };
	}
	return {
		text: characters.slice(0, limit).join(""),
		truncated: true,
		omitted: characters.length - limit,
	};
}

/**
 * Split a string into its outer leading whitespace, an editable core, and its
 * outer trailing whitespace.
 *
 * Rewrites send only the core to the backend and reassemble the original outer
 * whitespace locally. That keeps a paragraph's separation from its neighbours
 * exactly as the writer left it — including CRLF — while leaving whitespace
 * *inside* the selection free to change.
 */
export interface WhitespaceEnvelope {
	leading: string;
	core: string;
	trailing: string;
}

export function splitWhitespaceEnvelope(text: string): WhitespaceEnvelope {
	const leadingMatch = /^\s*/.exec(text);
	const leading = leadingMatch ? leadingMatch[0] : "";
	if (leading.length === text.length) {
		// The selection is entirely whitespace; treat it all as leading so that
		// reassembly is lossless and the core stays empty.
		return { leading: text, core: "", trailing: "" };
	}
	const rest = text.slice(leading.length);
	const trailingMatch = /\s*$/.exec(rest);
	const trailing = trailingMatch ? trailingMatch[0] : "";
	const core = rest.slice(0, rest.length - trailing.length);
	return { leading, core, trailing };
}

/** Reassemble an envelope around a (possibly rewritten) core. */
export function applyWhitespaceEnvelope(envelope: WhitespaceEnvelope, core: string): string {
	return `${envelope.leading}${core}${envelope.trailing}`;
}
