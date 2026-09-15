/**
 * Token diff for manuscript prose.
 *
 * Shape of the algorithm:
 *   1. tokenize both sides (see `tokenize.ts`);
 *   2. strip the common prefix and suffix — for a rewrite most of the text is
 *      untouched, so this removes almost all the work;
 *   3. run a longest-common-subsequence pass over what is left.
 *
 * Step 3 is quadratic, so it is only used while the remaining problem is small
 * enough. Above that, the text is split at line breaks and matched block by
 * block, then each changed block is diffed on its own. That keeps a very large
 * rewrite responsive without ever producing a wrong diff — the worst case is a
 * coarser diff, never an incorrect one.
 */

import { isNewlineToken, tokenize } from "./tokenize";

export type DiffOpKind = "equal" | "delete" | "insert";

export interface DiffOp {
	kind: DiffOpKind;
	text: string;
}

/** Largest LCS table we are willing to allocate, in cells. */
const MAX_LCS_CELLS = 4_000_000;

/** Diff two strings into a flat list of equal/delete/insert runs. */
export function diffText(before: string, after: string): DiffOp[] {
	if (before === after) {
		return before.length > 0 ? [{ kind: "equal", text: before }] : [];
	}
	return mergeOps(diffTokens(tokenize(before), tokenize(after)));
}

/** Diff two token arrays. Exposed for tests and for block-level recursion. */
export function diffTokens(before: string[], after: string[]): DiffOp[] {
	// --- 1. common prefix -------------------------------------------------
	let start = 0;
	const maxStart = Math.min(before.length, after.length);
	while (start < maxStart && before[start] === after[start]) {
		start += 1;
	}

	// --- 2. common suffix -------------------------------------------------
	let endBefore = before.length;
	let endAfter = after.length;
	while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
		endBefore -= 1;
		endAfter -= 1;
	}

	const ops: DiffOp[] = [];
	if (start > 0) {
		ops.push({ kind: "equal", text: before.slice(0, start).join("") });
	}

	const midBefore = before.slice(start, endBefore);
	const midAfter = after.slice(start, endAfter);
	ops.push(...diffMiddle(midBefore, midAfter));

	if (endBefore < before.length) {
		ops.push({ kind: "equal", text: before.slice(endBefore).join("") });
	}
	return ops;
}

/** Diff the part that the prefix/suffix pass could not resolve. */
function diffMiddle(before: string[], after: string[]): DiffOp[] {
	if (before.length === 0 && after.length === 0) return [];
	if (before.length === 0) return [{ kind: "insert", text: after.join("") }];
	if (after.length === 0) return [{ kind: "delete", text: before.join("") }];

	const cells = (before.length + 1) * (after.length + 1);
	if (cells <= MAX_LCS_CELLS) {
		return lcsDiff(before, after);
	}
	return blockDiff(before, after);
}

/** A run of same-kind tokens, still in backtrack (reverse) order. */
interface TokenRun {
	kind: DiffOpKind;
	tokens: string[];
}

/** Append a token to the open run, or start a new run when the kind changes. */
function pushToken(runs: TokenRun[], kind: DiffOpKind, token: string): void {
	const last = runs[runs.length - 1];
	if (last && last.kind === kind) {
		last.tokens.push(token);
		return;
	}
	runs.push({ kind, tokens: [token] });
}

/**
 * Classic LCS with a backtrack table.
 *
 * The table stores a direction per cell in a `Uint8Array`, which keeps a
 * 4M-cell problem at 4 MB instead of the 32 MB a number array would take. Only
 * two rows of lengths are live at a time.
 */
function lcsDiff(before: string[], after: string[]): DiffOp[] {
	const rows = before.length;
	const cols = after.length;
	const width = cols + 1;

	const DIAGONAL = 1;
	const LEFT = 3;

	const direction = new Uint8Array((rows + 1) * width);
	let previous = new Uint32Array(width);
	let current = new Uint32Array(width);

	for (let i = 1; i <= rows; i += 1) {
		const beforeToken = before[i - 1];
		for (let j = 1; j <= cols; j += 1) {
			if (beforeToken === after[j - 1]) {
				current[j] = previous[j - 1] + 1;
				direction[i * width + j] = DIAGONAL;
			} else if (previous[j] >= current[j - 1]) {
				current[j] = previous[j];
				direction[i * width + j] = 2; // UP
			} else {
				current[j] = current[j - 1];
				direction[i * width + j] = LEFT;
			}
		}
		const swap = previous;
		previous = current;
		current = swap;
		current.fill(0);
	}

	// Walk the table backwards, collecting runs of tokens in reverse order.
	// Tokens are kept in arrays rather than concatenated: a token can itself be
	// whitespace, so there is no separator that would be safe to join on and
	// split apart again.
	const reversedRuns: TokenRun[] = [];
	let i = rows;
	let j = cols;
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && direction[i * width + j] === DIAGONAL) {
			pushToken(reversedRuns, "equal", before[i - 1]);
			i -= 1;
			j -= 1;
		} else if (j > 0 && (i === 0 || direction[i * width + j] === LEFT)) {
			pushToken(reversedRuns, "insert", after[j - 1]);
			j -= 1;
		} else {
			pushToken(reversedRuns, "delete", before[i - 1]);
			i -= 1;
		}
	}

	reversedRuns.reverse();
	return reversedRuns.map((run) => ({
		kind: run.kind,
		text: run.tokens.reverse().join(""),
	}));
}

/**
 * Fallback for very large rewrites: match whole lines first, then diff only the
 * regions that actually differ.
 */
function blockDiff(before: string[], after: string[]): DiffOp[] {
	const beforeBlocks = splitIntoBlocks(before).map((block) => block.join(""));
	const afterBlocks = splitIntoBlocks(after).map((block) => block.join(""));

	// If even the block grid is too large, give up on structure and report the
	// whole region as replaced. Coarse, but never wrong.
	if ((beforeBlocks.length + 1) * (afterBlocks.length + 1) > MAX_LCS_CELLS) {
		return [
			{ kind: "delete", text: before.join("") },
			{ kind: "insert", text: after.join("") },
		];
	}

	const blockOps = lcsDiff(beforeBlocks, afterBlocks);

	// Re-expand: equal block runs stay equal; a delete run immediately followed
	// by an insert run is a modified region, so diff those two regions against
	// each other at token level.
	const ops: DiffOp[] = [];
	for (let index = 0; index < blockOps.length; index += 1) {
		const op = blockOps[index];
		const next = blockOps[index + 1];
		if (op.kind === "delete" && next?.kind === "insert") {
			const deleted = tokenize(op.text);
			const inserted = tokenize(next.text);
			if ((deleted.length + 1) * (inserted.length + 1) <= MAX_LCS_CELLS) {
				ops.push(...diffTokens(deleted, inserted));
			} else {
				ops.push({ kind: "delete", text: op.text });
				ops.push({ kind: "insert", text: next.text });
			}
			index += 1;
			continue;
		}
		ops.push({ kind: op.kind, text: op.text });
	}
	return ops;
}

/** Split a token stream into line blocks, keeping the newline with its line. */
function splitIntoBlocks(tokens: string[]): string[][] {
	const blocks: string[][] = [];
	let current: string[] = [];
	for (const token of tokens) {
		current.push(token);
		if (isNewlineToken(token)) {
			blocks.push(current);
			current = [];
		}
	}
	if (current.length > 0) blocks.push(current);
	return blocks;
}

/** Collapse adjacent runs of the same kind and drop empty ones. */
function mergeOps(ops: DiffOp[]): DiffOp[] {
	const merged: DiffOp[] = [];
	for (const op of ops) {
		if (op.text.length === 0) continue;
		const last = merged[merged.length - 1];
		if (last && last.kind === op.kind) {
			last.text += op.text;
			continue;
		}
		merged.push({ kind: op.kind, text: op.text });
	}
	return merged;
}

/** Reconstruct the original text from a diff. Used as a test invariant. */
export function reconstructBefore(ops: DiffOp[]): string {
	return ops
		.filter((op) => op.kind !== "insert")
		.map((op) => op.text)
		.join("");
}

/** Reconstruct the rewritten text from a diff. Used as a test invariant. */
export function reconstructAfter(ops: DiffOp[]): string {
	return ops
		.filter((op) => op.kind !== "delete")
		.map((op) => op.text)
		.join("");
}

/** How much of the text the diff left untouched, from 0 to 1. */
export function unchangedRatio(ops: DiffOp[]): number {
	let equal = 0;
	let total = 0;
	for (const op of ops) {
		const size = Array.from(op.text).length;
		total += size;
		if (op.kind === "equal") equal += size;
	}
	return total === 0 ? 1 : equal / total;
}
