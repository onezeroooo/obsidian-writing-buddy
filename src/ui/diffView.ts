/**
 * Rendering a diff for a reader of prose, not a reader of patches.
 *
 * Unchanged text stays completely neutral — same colour, same weight — so the
 * eye lands on what actually changed. Deletions and insertions are marked
 * inline rather than as whole replaced blocks, which is the entire point of the
 * fine-grained tokenizer feeding this.
 *
 * Paragraph structure is preserved by CSS (`white-space: pre-wrap`) rather than
 * by inserting `<br>`, so the text can still be selected and copied as written.
 */

import { t } from "../i18n";
import type { DiffOp } from "../diff/diff";

export type DiffViewMode = "diff" | "after" | "before";

/** A function, not a constant: a module constant would freeze the import-time locale. */
export function diffModeLabel(mode: DiffViewMode): string {
	if (mode === "after") return t("diff.after");
	if (mode === "before") return t("diff.before");
	return t("diff.diff");
}

/** Replace the contents of `container` with the diff in the requested mode. */
export function renderDiff(container: HTMLElement, ops: DiffOp[], mode: DiffViewMode): void {
	container.empty();
	container.addClass("wb-diff-body");

	for (const op of ops) {
		if (mode === "before" && op.kind === "insert") continue;
		if (mode === "after" && op.kind === "delete") continue;

		if (mode !== "diff" || op.kind === "equal") {
			container.createSpan({ text: op.text, cls: "wb-diff-equal" });
			continue;
		}

		container.createSpan({
			text: op.text,
			cls: op.kind === "delete" ? "wb-diff-delete" : "wb-diff-insert",
		});
	}
}

/** A short summary such as `+12 −5 字`, for the diff card header. */
export function summarizeDiff(ops: DiffOp[]): string {
	let inserted = 0;
	let deleted = 0;
	for (const op of ops) {
		const size = Array.from(op.text).length;
		if (op.kind === "insert") inserted += size;
		if (op.kind === "delete") deleted += size;
	}
	if (inserted === 0 && deleted === 0) return t("diff.noChange");
	return t("diff.summary", { inserted, deleted });
}
