/**
 * Range-level undo.
 *
 * What this is not: a whole-file restore, a Git checkout, or a call into the
 * editor's global undo stack. Any of those would throw away work the writer did
 * after the AI edit, which is exactly the outcome an "undo" button must never
 * produce.
 *
 * What it is: restoring one specific range, and only while that range still
 * holds exactly the text WritingBuddy wrote into it. The moment the writer
 * touches that passage, the automatic undo is withdrawn and the edit becomes
 * review-only history. Refusing is the safe answer, so every ambiguous case
 * refuses.
 */

import { t } from "../i18n";
import type { EditToken } from "../types";
import { type EditorLike, advancePosition, isPositionInBounds } from "./editor";

export type UndoRefusalReason =
	| "no-editor"
	| "file-changed"
	| "range-out-of-bounds"
	| "range-content-changed"
	| "already-undone";

export type UndoEligibility =
	| { canUndo: true }
	| { canUndo: false; reason: UndoRefusalReason; message: string };

export type UndoResult =
	| { undone: true; restoredTo: EditToken["to"] }
	| { undone: false; reason: UndoRefusalReason; message: string };



/**
 * Can this edit still be undone automatically?
 *
 * The test is content equality over the resulting range, not a timestamp and
 * not an edit counter — those can agree while the text has changed.
 */
export function checkUndoEligibility(
	editor: EditorLike | null,
	token: EditToken,
	currentFilePath: string | null,
): UndoEligibility {
	if (token.undone) {
		return { canUndo: false, reason: "already-undone", message: t("edit.alreadyUndone") };
	}
	if (!editor) {
		return {
			canUndo: false,
			reason: "no-editor",
			message: t("edit.undoFileNotOpen", { path: token.filePath }),
		};
	}
	if (currentFilePath !== token.filePath) {
		return {
			canUndo: false,
			reason: "file-changed",
			message: t("edit.undoWrongEditor", { path: token.filePath }),
		};
	}
	if (!isPositionInBounds(editor, token.from) || !isPositionInBounds(editor, token.to)) {
		return {
			canUndo: false,
			reason: "range-out-of-bounds",
			message: t("edit.undoRangeChanged"),
		};
	}
	if (editor.getRange(token.from, token.to) !== token.replacement) {
		return {
			canUndo: false,
			reason: "range-content-changed",
			message: t("edit.undoRangeChanged"),
		};
	}
	return { canUndo: true };
}

/** Restore the original text, or refuse and leave the document untouched. */
export function undoEdit(
	editor: EditorLike | null,
	token: EditToken,
	currentFilePath: string | null,
): UndoResult {
	const eligibility = checkUndoEligibility(editor, token, currentFilePath);
	if (!eligibility.canUndo) {
		return { undone: false, reason: eligibility.reason, message: eligibility.message };
	}
	const liveEditor = editor as EditorLike;

	liveEditor.replaceRange(token.originalText, token.from, token.to);
	const restoredTo = advancePosition(token.from, token.originalText);

	liveEditor.setSelection(token.from, restoredTo);
	liveEditor.scrollIntoView?.({ from: token.from, to: restoredTo }, true);

	return { undone: true, restoredTo };
}

/**
 * Mark a token as undone, returning a new token rather than mutating.
 *
 * The range is updated to cover the restored original text so the history entry
 * still describes a real region of the file.
 */
export function markUndone(token: EditToken, restoredTo: EditToken["to"]): EditToken {
	return { ...token, undone: true, to: restoredTo };
}

/**
 * The single edit that a top-level Undo button may act on.
 *
 * Only the most recent not-yet-undone edit qualifies. Older entries stay in the
 * history for review, because undoing them out of order would silently discard
 * everything applied on top of them.
 */
export function latestUndoableToken(tokens: EditToken[]): EditToken | null {
	for (let index = tokens.length - 1; index >= 0; index -= 1) {
		const token = tokens[index];
		if (!token.undone) return token;
	}
	return null;
}
