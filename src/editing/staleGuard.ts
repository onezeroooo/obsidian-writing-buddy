/**
 * Stale-selection protection.
 *
 * The failure this prevents: the writer selects a paragraph, asks for a
 * rewrite, keeps editing while the model works, and the replacement lands on
 * text that is no longer the text it was generated from. The result would be a
 * silent, hard-to-notice corruption of the manuscript.
 *
 * The rule is absolute: **apply only when the captured range still contains
 * exactly the captured text.** WritingBuddy never searches for a new home for a
 * replacement, never falls back to a first-string match, and never applies to a
 * "close enough" range. When the check fails the candidate is preserved for the
 * writer to review, and the document is left alone.
 */

import { t } from "../i18n";
import type { SelectionAttachment } from "../types";
import { type EditorLike, isPositionInBounds } from "./editor";

export type StaleReason =
	| "file-changed"
	| "range-out-of-bounds"
	| "range-content-changed"
	| "no-editor";

export type FreshnessResult =
	| { fresh: true }
	| { fresh: false; reason: StaleReason; message: string };

/** Message shown whenever a rewrite is refused because the text moved. */
/** A function so the sentence follows the locale (a constant would freeze it). */
export function staleMessage(): string {
	return t("edit.stale");
}

/**
 * Verify that an attachment still describes the document exactly.
 *
 * @param currentFilePath path of the file the editor is showing, if any.
 */
export function checkSelectionFreshness(
	editor: EditorLike | null,
	attachment: SelectionAttachment,
	currentFilePath: string | null,
): FreshnessResult {
	if (!editor) {
		return {
			fresh: false,
			reason: "no-editor",
			message: t("edit.staleWithDetail", { base: staleMessage(), detail: t("edit.staleDetailNotOpen", { path: attachment.filePath }) }),
		};
	}

	if (currentFilePath !== attachment.filePath) {
		return {
			fresh: false,
			reason: "file-changed",
			message: t("edit.staleWithDetail", { base: staleMessage(), detail: t("edit.staleDetailWrongEditor", { path: attachment.filePath }) }),
		};
	}

	// Bounds are checked before reading: Obsidian clamps an out-of-range
	// request instead of failing, and a clamped read could coincidentally
	// match, which would be the worst possible outcome.
	if (!isPositionInBounds(editor, attachment.from) || !isPositionInBounds(editor, attachment.to)) {
		return {
			fresh: false,
			reason: "range-out-of-bounds",
			message: t("edit.staleWithDetail", { base: staleMessage(), detail: t("edit.staleDetailOutOfRange") }),
		};
	}

	if (editor.getRange(attachment.from, attachment.to) !== attachment.text) {
		return {
			fresh: false,
			reason: "range-content-changed",
			message: staleMessage(),
		};
	}

	return { fresh: true };
}
