/**
 * Citation blocks: what a claim points at, inside the piece that was processed.
 *
 * A Full run divides the manuscript into ~7,000-character processing chunks,
 * and that size is right for what it is for — bounded, complete, cheap coverage
 * of a whole book. It is the wrong size for a citation. Clicking `[S17]` and
 * having seven thousand characters select is technically accurate provenance
 * and useless evidence: the reader still has to find the sentence themselves.
 *
 * So the unit the model cites is decoupled from the unit the run processes. The
 * chunk keeps its job — coverage, batching, call topology, aggregation — and
 * gains a chunk-local map of the prose blocks inside it. Nothing here changes
 * what is sent, how often, or in what groups; it only gives the model finer
 * names for parts of text it already has.
 *
 * The segmentation is deliberately dumb. It reads blank lines, Markdown
 * headings and fences — boundaries the manuscript already contains — and never
 * asks a model, an embedding, or a sentence tokenizer where a block begins. A
 * citation that cannot be recomputed identically from the same bytes is not
 * provenance, so determinism matters more here than cleverness.
 */

/** One citeable block, in chunk-local Unicode code-point offsets. */
export interface CitationBlock {
	/** `${evidenceId}.B${ordinal}`, e.g. `S17.B2`. */
	id: string;
	/** Half-open chunk-local offsets. Leading/trailing whitespace excluded. */
	startChar: number;
	endChar: number;
	text: string;
}

/**
 * The span past which a single block stops being a passage a reader can take in
 * at a glance and has to be divided further.
 *
 * This is not a target length — most prose paragraphs land far below it and are
 * never split. It is the ceiling for the pathological case: one unbroken wall
 * of text, which a manuscript does produce. At roughly a sixth of a processing
 * chunk, even a hard-split fragment is a material improvement on citing the
 * whole chunk, while staying large enough that ordinary paragraphs and short
 * dialogue exchanges survive intact.
 */
export const MAX_CITATION_BLOCK_CHARS = 1_200;

/**
 * A split is only worth making at a boundary that is reasonably far in.
 *
 * Without this, a late newline near the very start of an over-long block would
 * shear off a two-character fragment and leave the rest just as unusable.
 */
const MIN_SPLIT_RATIO = 0.4;

/** Sentence ends that already exist in the text. Not sentence *analysis*. */
const SENTENCE_TERMINATORS = new Set(["。", "！", "？", "；", "…", ".", "!", "?", ";"]);

/**
 * Divide one processing chunk into deterministic citation blocks.
 *
 * Returns blocks in document order. A chunk of only whitespace yields none: an
 * empty source keeps its existing whole-chunk identity rather than gaining an
 * empty block to cite.
 */
export function buildCitationBlocks(
	evidenceId: string,
	text: string,
	maxChars: number = MAX_CITATION_BLOCK_CHARS,
): readonly CitationBlock[] {
	const limit = Number.isSafeInteger(maxChars) && maxChars > 0 ? maxChars : MAX_CITATION_BLOCK_CHARS;
	const codePoints = Array.from(text);
	const spans = segmentSpans(codePoints);
	const blocks: CitationBlock[] = [];

	for (const span of spans) {
		for (const piece of divideOverlongSpan(codePoints, span, limit)) {
			blocks.push({
				id: `${evidenceId}.B${blocks.length + 1}`,
				startChar: piece.start,
				endChar: piece.end,
				text: codePoints.slice(piece.start, piece.end).join(""),
			});
		}
	}

	return Object.freeze(blocks.map((block) => Object.freeze(block)));
}

/**
 * Render a chunk with its block ids, as additional grounding structure.
 *
 * The complete chunk text still travels exactly once. Each block is preceded by
 * its id on its own line, so the model can name the paragraph it is relying on
 * without the text being duplicated, restructured, or sent per block.
 */
export function annotateWithCitationBlocks(text: string, blocks: readonly CitationBlock[]): string {
	if (blocks.length === 0) return text;
	const codePoints = Array.from(text);
	const parts: string[] = [];
	let cursor = 0;
	for (const block of blocks) {
		if (block.startChar < cursor || block.endChar > codePoints.length) continue;
		parts.push(codePoints.slice(cursor, block.startChar).join(""));
		parts.push(`[${block.id}]\n`);
		parts.push(codePoints.slice(block.startChar, block.endChar).join(""));
		cursor = block.endChar;
	}
	parts.push(codePoints.slice(cursor).join(""));
	return parts.join("");
}

/** `S17.B2` → `S17`. Returns null for anything that is not a block id. */
export function parentEvidenceId(id: string): string | null {
	const match = /^(S[1-9]\d*)\.B[1-9]\d*$/iu.exec(id.trim());
	return match ? (match[1] ?? "").toUpperCase() : null;
}

interface Span {
	start: number;
	end: number;
}

/**
 * Group the chunk into prose spans at boundaries the text already carries.
 *
 * A blank line ends a span and belongs to none, so a click selects the
 * paragraph rather than the paragraph plus the gap after it. A Markdown heading
 * is its own span even with no blank line beneath it, because a heading and the
 * paragraph under it are two different things to cite. Fenced code is opaque:
 * `#` inside a fence is content, not a heading, and blank lines inside a fence
 * do not divide it.
 */
function segmentSpans(codePoints: readonly string[]): Span[] {
	const spans: Span[] = [];
	let spanStart: number | null = null;
	let inFence = false;

	const closeSpan = (end: number): void => {
		if (spanStart === null) return;
		const trimmed = trimSpan(codePoints, spanStart, end);
		if (trimmed) spans.push(trimmed);
		spanStart = null;
	};

	for (const line of lineSpans(codePoints)) {
		const content = codePoints.slice(line.start, line.end).join("");
		if (/^\s*```/u.test(content)) {
			// The fence line joins the block it opens or closes, so a fenced
			// passage is cited as one thing rather than three.
			if (!inFence) closeSpan(line.start);
			inFence = !inFence;
			if (spanStart === null) spanStart = line.start;
			if (!inFence) closeSpan(line.end);
			continue;
		}
		if (inFence) {
			if (spanStart === null) spanStart = line.start;
			continue;
		}
		if (content.trim().length === 0) {
			closeSpan(line.start);
			continue;
		}
		if (/^\s{0,3}#{1,6}\s+\S/u.test(content)) {
			closeSpan(line.start);
			spans.push({ start: line.start, end: line.end });
			continue;
		}
		if (spanStart === null) spanStart = line.start;
	}
	closeSpan(codePoints.length);

	return spans;
}

/** Line boundaries in code-point offsets, treating CRLF as one break. */
function lineSpans(codePoints: readonly string[]): Span[] {
	const lines: Span[] = [];
	let start = 0;
	for (let at = 0; at < codePoints.length; at += 1) {
		const char = codePoints[at];
		if (char !== "\n" && char !== "\r") continue;
		lines.push({ start, end: at });
		if (char === "\r" && codePoints[at + 1] === "\n") at += 1;
		start = at + 1;
	}
	if (start <= codePoints.length - 1 || codePoints.length === 0) {
		lines.push({ start, end: codePoints.length });
	}
	return lines;
}

/** Drop surrounding whitespace so a selection begins and ends on real text. */
function trimSpan(codePoints: readonly string[], start: number, end: number): Span | null {
	let from = start;
	let to = end;
	while (from < to && (codePoints[from] ?? "").trim().length === 0) from += 1;
	while (to > from && (codePoints[to - 1] ?? "").trim().length === 0) to -= 1;
	return to > from ? { start: from, end: to } : null;
}

/**
 * Cut an over-long span at the last boundary the text already provides.
 *
 * Preference runs line break, then an existing sentence end, then — only when
 * neither exists within reach — the limit itself. The last case is a wall of
 * unbroken text with no punctuation, where any cut is arbitrary and a
 * deterministic one is the honest choice.
 */
function divideOverlongSpan(codePoints: readonly string[], span: Span, limit: number): Span[] {
	const pieces: Span[] = [];
	let start = span.start;

	while (span.end - start > limit) {
		const ceiling = start + limit;
		const floor = start + Math.max(1, Math.floor(limit * MIN_SPLIT_RATIO));
		let cut = -1;

		for (let at = ceiling; at > floor; at -= 1) {
			const char = codePoints[at - 1];
			if (char === "\n" || char === "\r") { cut = at; break; }
		}
		if (cut < 0) {
			for (let at = ceiling; at > floor; at -= 1) {
				if (SENTENCE_TERMINATORS.has(codePoints[at - 1] ?? "")) { cut = at; break; }
			}
		}
		if (cut < 0) cut = ceiling;

		const piece = trimSpan(codePoints, start, cut);
		if (piece) pieces.push(piece);
		start = cut;
	}

	const tail = trimSpan(codePoints, start, span.end);
	if (tail) pieces.push(tail);
	return pieces;
}
