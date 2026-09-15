/**
 * The rewrite review, inline in the conversation.
 *
 * It is not a panel wedged between the transcript and the composer any more —
 * it belongs to the answer that produced it, directly under the assistant's
 * reply, and scrolls away with it like everything else that was said.
 *
 * Preview first: the manuscript is untouched until 应用. Every safety guard is
 * unchanged — the stale check and the exact-range write simply happen when the
 * writer asks for them rather than beforehand.
 *
 * All three actions are always present and never move. 应用 becomes 已应用 in
 * place rather than disappearing, and 撤销 lights up beside it. Buttons that
 * vanish on state change take the writer's next click to wherever the remaining
 * button slid, which is how an undo becomes a copy.
 *
 * They sit **above** the diff. A long rewrite otherwise pushes 应用 off the
 * bottom of the pane, so accepting a change means scrolling past the whole thing
 * to find the button — and the button's position depends on how much the model
 * happened to write.
 */

import { t } from "../../i18n";
import type { DiffOp } from "../../diff/diff";
import type { EditToken, SelectionAttachment, Skill } from "../../types";
import type { RepeatedSpan } from "../../editing/adjacentRepetition";
import { type DiffViewMode, diffModeLabel, renderDiff, summarizeDiff } from "../diffView";
import { ICONS, iconSpan } from "../icons";

export interface RewriteCandidate {
	attachment: SelectionAttachment;
	instruction: string;
	skill?: Skill;
	/** The core text as returned, before the whitespace envelope is restored. */
	replacementCore: string;
	ops: DiffOp[];
	mode: DiffViewMode;
	/** `preview` until the writer applies it, and again after an undo. */
	phase: "preview" | "applied";
	/** Set when the passage has changed since generation. */
	staleNote?: string;
	/**
	 * Set when the Runtime had to salvage this replacement from a badly-formatted
	 * answer, so it may carry a preamble the model wrote to the reader rather
	 * than to the page.
	 */
	unverified?: boolean;
	/** Present once applied; the handle for a range-level undo. */
	token?: EditToken;
	/**
	 * Phrases this candidate shares with the sentences it will sit next to.
	 *
	 * Present only when there are any. A finding, not a verdict: a deliberate
	 * echo is a device and a recurring name is correct, so the card names the
	 * span and lets the writer decide.
	 */
	repetition?: RepeatedSpan[];
	/** True when the writer has changed the passage the model proposed. */
	edited?: boolean;
	/** What the model proposed, so the edit can be undone. */
	suggestedCore?: string;
}

export interface CandidateCardOptions {
	blockKey: string;
	candidate: RewriteCandidate;
	onSetMode: (mode: DiffViewMode) => void;
	onApply: () => void;
	/** Revert the applied range. Disabled until there is something to revert. */
	onUndo: () => void;
	onCopy: () => void;
	/** The writer typed in 修改后. Called as they type; no re-render. */
	onEdit: (text: string) => void;
	/** They finished typing; now the diff can be rebuilt. */
	onEditCommitted: () => void;
	/** Put the model's own wording back. */
	onRevertEdit: () => void;
}

export function renderCandidateCard(parent: HTMLElement, options: CandidateCardOptions): void {
	const { candidate } = options;
	const applied = candidate.phase === "applied";
	const card = parent.createDiv({ cls: `wb-candidate is-${candidate.phase}` });
	card.dataset.wbCandidateKey = options.blockKey;

	const head = card.createDiv({ cls: "wb-candidate-head" });
	head.createSpan({ cls: "wb-candidate-title", text: applied ? t("card.appliedTitle") : t("card.previewTitle") });
	head.createSpan({ cls: "wb-candidate-sub", text: summarizeDiff(candidate.ops) });
	head.createSpan({ cls: "wb-candidate-file", text: candidate.attachment.fileName });

	// A plain sentence, not a warning panel: nothing destructive has happened.
	if (candidate.staleNote && !applied) {
		card.createDiv({ cls: "wb-candidate-note", text: candidate.staleNote });
	}
	if (candidate.unverified && !applied) {
		card.createDiv({
			cls: "wb-candidate-note is-warning",
			text: t("card.formatWarning"),
		});
	}
	// Plain, and never a warning: repeating a phrase is a choice a writer is
	// allowed to make. This says what was repeated and stops there.
	if (candidate.repetition && candidate.repetition.length > 0 && !applied) {
		card.createDiv({
			cls: "wb-candidate-note",
			text: t("card.repetitionNote", {
				spans: candidate.repetition.map((span) => `「${span.text}」`).join("、"),
			}),
		});
	}

	// Controls above the diff, not below it. A long rewrite otherwise puts 应用
	// off the bottom of the pane, so accepting a change means scrolling past the
	// whole thing first — and the buttons move every time the content does.
	renderToolbar(card, options);

	// `修改后` is the one view that is not a rendering of something else — it is
	// the text itself, so it is the one you can type into. `差异` is computed
	// and `修改前` is the manuscript as it stands; making either editable would
	// be offering to edit a picture of something.
	if (candidate.mode === "after" && !applied) {
		renderEditor(card, options);
		return;
	}
	renderDiff(card.createDiv(), candidate.ops, candidate.mode);
}

/**
 * The passage, editable.
 *
 * A model's suggestion is usually nearly right, and fixing the last clause used
 * to mean copying it out, editing it elsewhere, and pasting over the original by
 * hand — which loses the exact-range apply and the undo token with it.
 *
 * Typing does **not** re-render: the caret would jump to the end on every
 * keystroke. The value is recorded as it is typed and the card is rebuilt when
 * the writer leaves the box, which is when the diff becomes worth looking at
 * again.
 */
function renderEditor(card: HTMLElement, options: CandidateCardOptions): void {
	const { candidate } = options;

	const editor = card.createEl("textarea", {
		cls: "wb-diff-editor",
		attr: { "aria-label": t("card.editableAria"), spellcheck: "false" },
	});
	editor.value = candidate.replacementCore;
	grow(editor);

	editor.addEventListener("input", () => {
		grow(editor);
		options.onEdit(editor.value);
	});
	// Committing on blur rather than on every keystroke keeps the caret where
	// the writer put it.
	//
	// Only when something was actually typed. Selecting a passage here, copying
	// it, and clicking away is an ordinary thing to do, and it used to commit —
	// rebuilding the whole thread to restate text that had not changed. That
	// rebuild empties the container and reassigns `scrollTop` while the new
	// cards are still sizing themselves, so a long conversation gets clamped
	// toward the top and the anchor correction, which runs a task later, cannot
	// recover it. `replacementCore` is the value this card was rendered with, so
	// comparing against it also stays correct after a real edit has committed.
	editor.addEventListener("blur", () => {
		if (editor.value === candidate.replacementCore) return;
		options.onEditCommitted();
	});

	const foot = card.createDiv({ cls: "wb-diff-editor-foot" });
	foot.createSpan({
		cls: "wb-diff-editor-hint",
		text: candidate.edited ? t("card.editedHint") : t("card.editableHint"),
	});
	if (candidate.edited) {
		const revert = foot.createEl("button", {
			cls: "wb-diff-action",
			text: t("card.revertAI"),
			attr: { type: "button", title: t("card.revertAITooltip") },
		});
		pressWithoutStealingFocus(revert);
		revert.addEventListener("click", () => options.onRevertEdit());
	}
}

/**
 * Let a control be pressed without taking focus from the editable text.
 *
 * `修改后` is a real textarea, and committing an edit rebuilds the card. A
 * button that takes focus therefore blurs the textarea on `mousedown`, the
 * rebuild replaces the button before `mouseup`, and the browser never dispatches
 * the `click` — the press is silently swallowed and the writer presses again.
 * Preventing the default `mousedown` keeps focus where it is; the click still
 * fires, and the edit still commits when focus genuinely leaves.
 */
function pressWithoutStealingFocus(button: HTMLElement): void {
	button.addEventListener("mousedown", (event) => event.preventDefault());
}

/** Grow the box with its content rather than scrolling inside a small one. */
function grow(editor: HTMLTextAreaElement): void {
	editor.style.height = "auto";
	editor.style.height = `${Math.min(editor.scrollHeight + 2, window.innerHeight * 0.6)}px`;
}

function renderToolbar(card: HTMLElement, options: CandidateCardOptions): void {
	const { candidate } = options;
	const applied = candidate.phase === "applied";
	const toolbar = card.createDiv({ cls: "wb-diff-toolbar" });

	const modes = toolbar.createDiv({ cls: "wb-diff-modes", attr: { role: "tablist" } });
	for (const mode of ["diff", "after", "before"] as DiffViewMode[]) {
		const active = candidate.mode === mode;
		const button = modes.createEl("button", {
			cls: `wb-diff-mode${active ? " is-active" : ""}`,
			text: diffModeLabel(mode),
			attr: { type: "button", role: "tab", "aria-selected": String(active) },
		});
		pressWithoutStealingFocus(button);
		button.addEventListener("click", () => {
			// Pressing the tab you are already on used to rebuild the whole
			// thread to arrive at exactly the same screen — the same needless
			// teardown that threw the writer to the top of the conversation
			// when a rewrite box lost focus. `active` is read from the rendered
			// card, so it is the mode actually on screen rather than the
			// stored one, which is absent until the writer picks a view.
			if (active) return;
			options.onSetMode(mode);
		});
	}

	const actions = toolbar.createDiv({ cls: "wb-diff-actions" });

	action(actions, {
		icon: ICONS.apply,
		label: applied ? t("card.applied") : t("card.apply"),
		tooltip: applied ? t("card.appliedTooltip") : t("card.applyTooltip"),
		disabled: applied,
		cls: applied ? "is-done" : "",
		onClick: options.onApply,
	});
	action(actions, {
		icon: ICONS.undo,
		label: t("card.undo"),
		tooltip: applied ? t("card.undoTooltip") : t("card.undoBeforeApply"),
		disabled: !applied,
		onClick: options.onUndo,
	});
	action(actions, {
		icon: ICONS.copy,
		label: t("card.copyAfter"),
		tooltip: t("card.copyAfterTooltip"),
		disabled: false,
		onClick: options.onCopy,
	});
}

interface ActionOptions {
	icon: string;
	label: string;
	tooltip: string;
	disabled: boolean;
	cls?: string;
	onClick: () => void;
}

function action(parent: HTMLElement, options: ActionOptions): void {
	const button = parent.createEl("button", {
		cls: `wb-diff-action${options.cls ? ` ${options.cls}` : ""}`,
		// aria-label only — a `title` here would add a second, native tooltip
		// on top of the Obsidian-styled one.
		attr: {
			type: "button",
			"aria-label": `${options.label}：${options.tooltip}`,
		},
	});
	iconSpan(button, options.icon);
	button.createSpan({ text: options.label });
	// Disabled rather than absent: the row's shape is the same in every state,
	// so no button is ever where a different one used to be.
	button.disabled = options.disabled;
	pressWithoutStealingFocus(button);
	button.addEventListener("click", () => {
		if (!options.disabled) options.onClick();
	});
}
