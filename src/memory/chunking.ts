/**
 * Cutting a chapter into position-ordered pieces of retainable size.
 *
 * A chapter is one document to the writer and one file to the Vault, but a
 * 40,000-character chapter is not one unit of extraction: Recanta bounds the
 * input one processing run may read, and a fact needs a position finer than
 * "somewhere in chapter eleven" for the story-position boundary to mean
 * anything. Chunks follow the chapter's own headings first and split long
 * sections at paragraph boundaries second, so a chunk is always whole prose.
 *
 * The split is deterministic for a given text, and every chunk carries its
 * UTF-16 offsets into the chapter, so a citation can be relocated exactly.
 */

import { contentRevision } from "../context/revision";

export interface ManuscriptChunk {
	/** Zero-based order within the document. */
	index: number;
	/** The nearest heading above the chunk, if any. */
	heading: string | null;
	text: string;
	start: number;
	end: number;
	/** Content identity of this chunk alone. */
	revision: string;
}

/**
 * Recanta processes 32 KiB of input per run and accepts at most 32 candidates
 * from it; the answer is the facts of the chunk, not the chunk itself (see
 * `EXTRACTION_OUTPUT_TOKENS`). Dense Chinese prose states well under 32
 * facts in this many characters, so the limit that remains is the writer's:
 * a chunk is also the grain at which knowledge is placed in the story, and
 * the boundary before which a turn may know. Three thousand characters is a
 * scene or two, and halves the requests the earlier 1,500 needed.
 */
export const DEFAULT_CHUNK_CHARS = 3_000;
export const MIN_CHUNK_CHARS = 800;

export function chunkManuscript(text: string, maxChars = DEFAULT_CHUNK_CHARS): ManuscriptChunk[] {
	const limit = Math.max(MIN_CHUNK_CHARS, maxChars);
	const body = stripFrontmatter(text);
	const sections = splitAtHeadings(body.text, body.offset);
	const chunks: ManuscriptChunk[] = [];
	for (const section of sections) {
		for (const piece of splitLong(section.text, section.start, limit)) {
			if (!piece.text.trim()) continue;
			chunks.push({
				index: chunks.length,
				heading: section.heading,
				text: piece.text,
				start: piece.start,
				end: piece.start + piece.text.length,
				revision: contentRevision(piece.text),
			});
		}
	}
	return chunks;
}

/** Frontmatter is metadata for the lifecycle, never manuscript text for memory. */
export function stripFrontmatter(text: string): { text: string; offset: number; frontmatter: string | null } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text);
	if (!match) return { text, offset: 0, frontmatter: null };
	return { text: text.slice(match[0].length), offset: match[0].length, frontmatter: match[1] };
}

/** A scalar frontmatter value such as `pov: 林昭` or `ordinal: 3`. */
export function frontmatterValue(frontmatter: string | null, key: string): string | null {
	if (!frontmatter) return null;
	const match = new RegExp(`^${key}\\s*:\\s*(.+?)\\s*$`, "imu").exec(frontmatter);
	if (!match) return null;
	return match[1].replace(/^["']|["']$/gu, "").trim() || null;
}

/** A list frontmatter value, inline (`[a, b]`) or block (`- a`). */
export function frontmatterList(frontmatter: string | null, key: string): string[] {
	if (!frontmatter) return [];
	const lines = frontmatter.split(/\r?\n/u);
	for (let index = 0; index < lines.length; index += 1) {
		const match = new RegExp(`^${key}\\s*:\\s*(.*)$`, "iu").exec(lines[index]);
		if (!match) continue;
		const inline = match[1].trim();
		if (inline.startsWith("[")) {
			return inline.replace(/^\[|\]$/gu, "").split(",").map((item) => item.trim().replace(/^["']|["']$/gu, "")).filter(Boolean);
		}
		if (inline) return [inline.replace(/^["']|["']$/gu, "")];
		const items: string[] = [];
		for (let child = index + 1; child < lines.length && /^\s+-\s*/u.test(lines[child]); child += 1) {
			const item = lines[child].replace(/^\s+-\s*/u, "").trim().replace(/^["']|["']$/gu, "");
			if (item) items.push(item);
		}
		return items;
	}
	return [];
}

interface Section { heading: string | null; text: string; start: number }

function splitAtHeadings(text: string, offset: number): Section[] {
	const sections: Section[] = [];
	const pattern = /^\s{0,3}#{1,6}\s+(.*\S)\s*$/gmu;
	let heading: string | null = null;
	let start = 0;
	for (const match of text.matchAll(pattern)) {
		const at = match.index;
		if (at > start) sections.push({ heading, text: text.slice(start, at), start: offset + start });
		heading = match[1].trim();
		start = at;
	}
	sections.push({ heading, text: text.slice(start), start: offset + start });
	return sections.filter((section) => section.text.trim().length > 0);
}

function splitLong(text: string, start: number, limit: number): Array<{ text: string; start: number }> {
	if (text.length <= limit) return [{ text, start }];
	const pieces: Array<{ text: string; start: number }> = [];
	let cursor = 0;
	while (cursor < text.length) {
		let end = Math.min(text.length, cursor + limit);
		if (end < text.length) {
			const window = text.slice(cursor, end);
			const paragraph = window.lastIndexOf("\n\n");
			const line = window.lastIndexOf("\n");
			const sentence = Math.max(window.lastIndexOf("。"), window.lastIndexOf("."), window.lastIndexOf("！"), window.lastIndexOf("？"));
			const cut = paragraph > limit / 3 ? paragraph + 2 : line > limit / 3 ? line + 1 : sentence > limit / 3 ? sentence + 1 : window.length;
			end = cursor + cut;
		}
		pieces.push({ text: text.slice(cursor, end), start: start + cursor });
		cursor = end;
	}
	return pieces;
}
