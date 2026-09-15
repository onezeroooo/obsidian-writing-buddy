/**
 * Applying a replacement to the manuscript.
 *
 * Two rules govern this file:
 *
 *   1. The edit is applied to the **exact captured range**, via `replaceRange`.
 *      Never a whole-file write, never a search-and-replace. Duplicated text
 *      elsewhere in the chapter is therefore harmless — the range is the
 *      identity, not the string.
 *
 *   2. The outer whitespace of the selection is restored locally. The backend
 *      only ever sees and returns the trimmed core, so it cannot accidentally
 *      eat the blank line that separates two paragraphs, or convert CRLF to LF.
 *      Whitespace *inside* the selection stays editable.
 */

import { t } from "../i18n";
import type { EditToken, SelectionAttachment } from "../types";
import { createEditId, nowIso } from "../util/id";
import { applyWhitespaceEnvelope, splitWhitespaceEnvelope } from "../util/text";
import { type EditorLike, advancePosition } from "./editor";
import { type FreshnessResult, checkSelectionFreshness } from "./staleGuard";

export type ApplyResult =
	| { applied: true; token: EditToken }
	| { applied: false; reason: string; message: string };

export interface ApplyOptions {
	editor: EditorLike | null;
	attachment: SelectionAttachment;
	/** The core text returned by the backend, already parsed and untrimmed. */
	replacementCore: string;
	currentFilePath: string | null;
	skillId?: string;
	/** Move the cursor/selection onto the new text after applying. */
	reveal?: boolean;
}

/**
 * The text that should actually be sent for rewriting: the selection minus its
 * outer whitespace. The caller keeps the envelope to rebuild the full text.
 */
export function rewritableCore(attachment: SelectionAttachment): string {
	return splitWhitespaceEnvelope(attachment.text).core;
}

/** Reassemble a backend core into the exact text to write into the range. */
export function assembleReplacement(attachment: SelectionAttachment, core: string): string {
	return applyWhitespaceEnvelope(splitWhitespaceEnvelope(attachment.text), core);
}

/**
 * Turn a continuation into a candidate for the captured range.
 *
 * `continue` is applied through the same exact-range machinery as a rewrite, so
 * it inherits the stale check and the undo token. But its semantics are
 * *insertion*, not replacement: the skill tells the model "只输出续写的正文本身，
 * 不要重复已有内容", so a well-behaved Runtime returns only the new prose. Writing
 * that into the range would delete the passage the writer selected.
 *
 * So the original core is put back in front of it. The guard handles the other
 * case too: a model that echoes the passage before continuing would otherwise
 * end up duplicated. Both bundled mocks do exactly that, which is why this bug
 * never surfaced in mock testing.
 */
export function assembleContinuation(core: string, returned: string): string {
	const trimmedCore = core.trim();
	const trimmedReturned = returned.trim();

	if (trimmedCore.length === 0) return returned;
	// Already contains the passage: the model echoed it, so take it as given.
	if (trimmedReturned.startsWith(trimmedCore)) return returned;

	// Join without inventing a separator — the skill requires the continuation
	// to read directly on from the selection — unless the core already ends on
	// a line break, which we preserve.
	return `${core}${returned}`;
}

/**
 * Apply a replacement, or refuse.
 *
 * There is no third outcome: this function either writes the exact range or
 * leaves the document byte-for-byte untouched.
 */
export function applyReplacement(options: ApplyOptions): ApplyResult {
	const { editor, attachment, replacementCore, currentFilePath } = options;

	const freshness: FreshnessResult = checkSelectionFreshness(editor, attachment, currentFilePath);
	if (!freshness.fresh) {
		return { applied: false, reason: freshness.reason, message: freshness.message };
	}
	// `checkSelectionFreshness` returning fresh guarantees a non-null editor.
	const liveEditor = editor as EditorLike;

	const replacement = assembleReplacement(attachment, replacementCore);
	if (replacement === attachment.text) {
		return {
			applied: false,
			reason: "no-change",
			message: t("edit.noChangeProduced"),
		};
	}

	liveEditor.replaceRange(replacement, attachment.from, attachment.to);
	const resultingTo = advancePosition(attachment.from, replacement);

	if (options.reveal !== false) {
		liveEditor.setSelection(attachment.from, resultingTo);
		liveEditor.scrollIntoView?.({ from: attachment.from, to: resultingTo }, true);
	}

	const token: EditToken = {
		id: createEditId(),
		filePath: attachment.filePath,
		originalText: attachment.text,
		replacement,
		from: { ...attachment.from },
		to: resultingTo,
		appliedAt: nowIso(),
		undone: false,
	};
	if (options.skillId) token.skillId = options.skillId;

	return { applied: true, token };
}
