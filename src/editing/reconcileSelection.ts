/**
 * Re-verifying a captured passage before it is sent.
 *
 * The stale guard already protects the *apply* path: a candidate is written
 * back only when the captured range still holds exactly the captured text. The
 * send path had no equivalent, and that asymmetry is the bug this module
 * closes.
 *
 * A selection attachment is a snapshot. It normally re-captures itself on any
 * focused editor gesture, but a document can change without one: Obsidian Sync,
 * an external editor, another plugin rewriting the buffer on save, or
 * WritingBuddy applying a candidate for a *different* passage further up the
 * file. In every one of those cases the attachment survives while the prose it
 * describes has moved or gone.
 *
 * Sending a stale snapshot is not a cosmetic problem. `ContextAssembler` strips
 * the selection from the active-file document by exact string match, so a stale
 * snapshot fails to dedup and the model receives the old passage *and* the new
 * body at once — and `PRODUCT_POLICY` ranks the selection above the manuscript,
 * so it faithfully works on the text the writer already replaced.
 *
 * The rules mirror `reanchor.ts` rather than relaxing them:
 *
 *   - **Exact text only.** No normalisation, no fuzzy match.
 *   - **Unique or refuse.** A passage found once is re-anchored silently; one
 *     that is missing or indistinguishably duplicated stops the turn.
 *   - **Unverifiable is not stale.** A file open in no editor cannot be checked,
 *     and refusing there would break the legitimate "I selected this, closed the
 *     chapter, let us keep talking about it" flow.
 */

import { t } from "../i18n";
import type { SelectionAttachment } from "../types";
import type { EditorLike } from "./editor";
import { checkSelectionFreshness, type StaleReason } from "./staleGuard";
import { reanchorSelection } from "./reanchor";
import { attachmentFromRange } from "./selection";

/**
 * Refusal shown when the captured passage is genuinely no longer in the file.
 *
 * It names the cause rather than the mechanism: the writer changed the prose,
 * which is an ordinary thing to do, and the only thing WritingBuddy needs from
 * them is a fresh selection.
 */
export const SELECTION_GONE_MESSAGE =
	t("edit.selectionGone");

export type SelectionReconciliation =
	/** The captured range still holds the captured text. Nothing to write. */
	| { status: "fresh"; attachment: SelectionAttachment }
	/** The passage moved. `attachment` is the refreshed snapshot to store. */
	| { status: "reanchored"; attachment: SelectionAttachment }
	/** No editor holds this file, so nothing can be checked. Used unchanged. */
	| { status: "unverifiable"; attachment: SelectionAttachment; reason: StaleReason }
	/** Not in the buffer at all, or there several times indistinguishably. */
	| { status: "gone"; reason: "not-found" | "ambiguous"; message: string };

/**
 * Decide what the send path should do with a captured passage.
 *
 * `editor` must be the editor showing the attachment's *own* file — not
 * whatever the writer happens to be looking at. `currentFilePath` is that
 * editor's path, or null when no editor could be resolved.
 */
export function reconcileSelectionAttachment(
	editor: EditorLike | null,
	attachment: SelectionAttachment,
	currentFilePath: string | null,
): SelectionReconciliation {
	const freshness = checkSelectionFreshness(editor, attachment, currentFilePath);
	if (freshness.fresh) return { status: "fresh", attachment };

	// Nothing to compare against. Leaving the attachment alone is the only
	// honest answer: it is still the passage the writer chose, and the assembler
	// has no live text for this file either, so it cannot contradict itself.
	if (!editor || freshness.reason === "no-editor" || freshness.reason === "file-changed") {
		return { status: "unverifiable", attachment, reason: freshness.reason };
	}

	const relocated = reanchorSelection(editor, attachment, {
		...(attachment.before ? { before: attachment.before } : {}),
		...(attachment.after ? { after: attachment.after } : {}),
	});
	if (!relocated.ok) {
		return { status: "gone", reason: relocated.reason, message: SELECTION_GONE_MESSAGE };
	}

	const refreshed = attachmentFromRange(editor, attachment.filePath, relocated.from, relocated.to);
	// `reanchorSelection` only reports a range it read the passage out of, so an
	// empty rebuild would mean the buffer changed underneath this very call.
	// Treat that as gone rather than as a silent partial refresh.
	if (!refreshed) {
		return { status: "gone", reason: "not-found", message: SELECTION_GONE_MESSAGE };
	}
	return { status: "reanchored", attachment: refreshed };
}

/**
 * True only when the passage is *provably* absent from the live document.
 *
 * Used to mark a historical referent as superseded. Unknown text — a file open
 * in no editor — is never superseded: a marker claiming the writer changed
 * something they did not is worse than quoting a passage that is still there.
 *
 * Position is deliberately ignored. A historical referent is about the prose,
 * not about the coordinates it used to occupy.
 */
export function selectionSuperseded(
	liveText: string | null,
	selection: SelectionAttachment,
): boolean {
	if (liveText === null || selection.text.length === 0) return false;
	return !liveText.includes(selection.text);
}
