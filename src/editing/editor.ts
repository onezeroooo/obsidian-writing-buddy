/**
 * The slice of Obsidian's editor that WritingBuddy actually needs.
 *
 * The editing logic is written against this interface rather than against
 * `obsidian.Editor` so that every guard — stale detection, exact-range apply,
 * safe undo — is testable in plain Node against a small fake. Obsidian's real
 * `Editor` satisfies this shape, so the adapter is a cast, not a wrapper.
 */

import type { DocPosition } from "../types";

export interface EditorLike {
	getValue(): string;
	getLine(line: number): string;
	lineCount(): number;
	getRange(from: DocPosition, to: DocPosition): string;
	replaceRange(replacement: string, from: DocPosition, to: DocPosition): void;
	getSelection(): string;
	getCursor(side?: "from" | "to" | "head" | "anchor"): DocPosition;
	setSelection(anchor: DocPosition, head: DocPosition): void;
	somethingSelected?(): boolean;
	scrollIntoView?(range: { from: DocPosition; to: DocPosition }, center?: boolean): void;
	focus?(): void;
}

/** True when `position` addresses a real spot in the document. */
export function isPositionInBounds(editor: EditorLike, position: DocPosition): boolean {
	if (position.line < 0 || position.ch < 0) return false;
	if (position.line >= editor.lineCount()) return false;
	return position.ch <= editor.getLine(position.line).length;
}

export function comparePositions(a: DocPosition, b: DocPosition): number {
	if (a.line !== b.line) return a.line - b.line;
	return a.ch - b.ch;
}

export function positionsEqual(a: DocPosition, b: DocPosition): boolean {
	return a.line === b.line && a.ch === b.ch;
}

/**
 * Where a range that starts at `from` ends after `text` is written into it.
 *
 * Line breaks are counted as CR, LF, or CRLF, because a manuscript written on
 * Windows and synced to another machine can contain any of them and getting
 * this wrong would put the undo range in the wrong place.
 */
export function advancePosition(from: DocPosition, text: string): DocPosition {
	const lines = text.split(/\r\n|\n|\r/);
	if (lines.length === 1) {
		return { line: from.line, ch: from.ch + lines[0].length };
	}
	return {
		line: from.line + lines.length - 1,
		ch: lines[lines.length - 1].length,
	};
}
