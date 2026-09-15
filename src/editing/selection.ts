/**
 * Capturing what the writer selected.
 *
 * A captured selection is *context*: attaching it to a chat says "here is the
 * passage I am asking about", and nothing more. Only an explicit rewrite action
 * is ever allowed to turn a selection into an edit.
 */

import { t } from "../i18n";
import type { DocPosition, SelectionAttachment } from "../types";
import { countChars, previewOf } from "../util/text";
import { baseName } from "../util/text";
import { nowIso } from "../util/id";
import { type EditorLike, comparePositions } from "./editor";

const SELECTION_REFERENCE_CHARS = 1_600;

/**
 * Snapshot the current selection.
 *
 * Returns `null` when nothing is selected — an empty selection is not an
 * attachment, and silently attaching a zero-length range would produce a chip
 * that claims context it does not have.
 */
export function captureSelection(editor: EditorLike, filePath: string): SelectionAttachment | null {
	const rawFrom = editor.getCursor("from");
	const rawTo = editor.getCursor("to");

	// Normalise direction: a selection dragged upwards reports head before
	// anchor, and every downstream guard assumes from <= to.
	const [from, to] = comparePositions(rawFrom, rawTo) <= 0 ? [rawFrom, rawTo] : [rawTo, rawFrom];

	const text = editor.getRange(from, to);
	if (text.length === 0) return null;

	const lastLine = Math.max(0, editor.lineCount() - 1);
	const before = tail(editor.getRange({ line: 0, ch: 0 }, from), SELECTION_REFERENCE_CHARS);
	const after = head(
		editor.getRange(to, { line: lastLine, ch: editor.getLine(lastLine).length }),
		SELECTION_REFERENCE_CHARS,
	);
	return buildAttachment(filePath, from, to, text, { before, after });
}

/** Build an attachment from an already-known range. */
export function buildAttachment(
	filePath: string,
	from: DocPosition,
	to: DocPosition,
	text: string,
	surrounding?: { before?: string; after?: string },
): SelectionAttachment {
	return {
		filePath,
		fileName: baseName(filePath),
		from: { line: from.line, ch: from.ch },
		to: { line: to.line, ch: to.ch },
		text,
		charCount: countChars(text),
		preview: previewOf(text),
		...(surrounding?.before ? { before: surrounding.before } : {}),
		...(surrounding?.after ? { after: surrounding.after } : {}),
		capturedAt: nowIso(),
	};
}

/** Rebuild a persistent referent after local apply/undo changed its range. */
export function attachmentFromRange(
	editor: EditorLike,
	filePath: string,
	from: DocPosition,
	to: DocPosition,
): SelectionAttachment | null {
	const text = editor.getRange(from, to);
	if (!text) return null;
	const lastLine = Math.max(0, editor.lineCount() - 1);
	return buildAttachment(filePath, from, to, text, {
		before: tail(editor.getRange({ line: 0, ch: 0 }, from), SELECTION_REFERENCE_CHARS),
		after: head(editor.getRange(to, { line: lastLine, ch: editor.getLine(lastLine).length }), SELECTION_REFERENCE_CHARS),
	});
}

function head(text: string, limit: number): string {
	const chars = Array.from(text);
	return chars.length <= limit ? text : `${chars.slice(0, limit).join("")}…`;
}

function tail(text: string, limit: number): string {
	const chars = Array.from(text);
	return chars.length <= limit ? text : `…${chars.slice(-limit).join("")}`;
}

/** The chip label, e.g. `第03章.md · 已选 128 字`. */
export function describeAttachment(attachment: SelectionAttachment): string {
	return t("edit.selectedChars", { name: attachment.fileName, count: attachment.charCount });
}

/** True when two attachments point at exactly the same text and range. */
export function sameAttachment(a: SelectionAttachment, b: SelectionAttachment): boolean {
	return (
		a.filePath === b.filePath &&
		a.text === b.text &&
		a.from.line === b.from.line &&
		a.from.ch === b.from.ch &&
		a.to.line === b.to.line &&
		a.to.ch === b.to.ch
	);
}
