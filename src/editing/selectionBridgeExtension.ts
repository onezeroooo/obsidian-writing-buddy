/** CodeMirror-facing half of the selection bridge. */

import type { Extension, EditorState } from "@codemirror/state";
import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { editorInfoField, type Editor } from "obsidian";

import type { DocPosition, SelectionAttachment } from "../types";
import { shouldHideNativeSelection, shouldObserveSelectionUpdate } from "./selectionBridge";

export interface MarkdownSelectionUpdate {
	editor: Editor;
	filePath: string;
	selectionSet: boolean;
	focusChanged: boolean;
	hasFocus: boolean;
	userSelection: boolean;
	userEdit: boolean;
	programmaticSelection: boolean;
}

export interface SelectionBridgeExtensionCallbacks {
	currentSelection(): SelectionAttachment | null;
	onCreate(view: EditorView): void;
	onUpdate(update: MarkdownSelectionUpdate): void;
	onDestroy(view: EditorView): void;
}

const setAttachedSelectionEffect = StateEffect.define<SelectionAttachment | null>();
const programmaticSelectionEffect = StateEffect.define<null>();

/**
 * Observe native CodeMirror selection transactions and keep a persistent mark
 * available after the browser's native selection loses focus to the composer.
 */
export function createSelectionBridgeExtension(
	callbacks: SelectionBridgeExtensionCallbacks,
): Extension {
	const attachedSelectionField = StateField.define<DecorationSet>({
		create: (state) => decorationsFor(state, callbacks.currentSelection()),
		update: (decorations, transaction) => {
			for (const effect of transaction.effects) {
				if (effect.is(setAttachedSelectionEffect)) {
					return decorationsFor(transaction.state, effect.value);
				}
			}
			const previousPath = markdownInfo(transaction.startState)?.filePath ?? null;
			const nextPath = markdownInfo(transaction.state)?.filePath ?? null;
			if (previousPath !== nextPath) return decorationsFor(transaction.state, callbacks.currentSelection());
			if (!transaction.docChanged) return decorations;
			const selected = callbacks.currentSelection();
			if (!selected || selected.filePath !== nextPath) return Decoration.none;
			// The persisted attachment is the single source of truth. Rebuilding from
			// it (instead of mapping the mark) avoids visually moving a highlight
			// while its stored line/ch snapshot still points at the old range.
			return decorationsFor(transaction.state, selected);
		},
		provide: (field) => [
			EditorView.decorations.from(field),
			EditorView.editorAttributes.from(field, (decorations) => ({
				class: decorations.size > 0 ? "wb-has-attached-selection" : "",
			})),
		],
	});
	const nativeSelectionVisibilityField = StateField.define<boolean>({
		create: (state) => nativeSelectionNeedsHiding(state, callbacks.currentSelection()),
		update: (hidden, transaction) => {
			for (const effect of transaction.effects) {
				if (effect.is(setAttachedSelectionEffect)) {
					return nativeSelectionNeedsHiding(transaction.state, effect.value);
				}
				if (effect.is(programmaticSelectionEffect)) return false;
			}
			if (transaction.isUserEvent("select") || isUserEdit(transaction)) return false;
			return hidden;
		},
		provide: (field) => EditorView.editorAttributes.from(field, (hidden) => ({
			class: hidden ? "wb-hide-native-selection" : "",
		})),
	});

	const observer = ViewPlugin.fromClass(class {
		constructor(readonly view: EditorView) {
			callbacks.onCreate(view);
		}

		update(update: ViewUpdate): void {
			const info = markdownInfo(update.state);
			if (info) {
				callbacks.onUpdate({
					editor: info.editor,
					filePath: info.filePath,
					selectionSet: update.selectionSet,
					focusChanged: update.focusChanged,
					hasFocus: update.view.hasFocus,
					userSelection: update.transactions.some((transaction) => transaction.isUserEvent("select")),
					userEdit: update.transactions.some(isUserEdit),
					programmaticSelection: update.transactions.some((transaction) =>
						transaction.effects.some((effect) => effect.is(programmaticSelectionEffect)),
					),
				});
			}
		}

		destroy(): void {
			callbacks.onDestroy(this.view);
		}
	});

	return [attachedSelectionField, nativeSelectionVisibilityField, observer];
}

/** Replace the persistent attachment mark in one editor without moving its caret. */
export function showAttachedSelection(
	view: EditorView,
	selection: SelectionAttachment | null,
): void {
	view.dispatch({ effects: setAttachedSelectionEffect.of(selection) });
}

/**
 * Set a range with an explicit bridge marker. Using CodeMirror directly keeps
 * programmatic navigation distinguishable from keyboard/pointer selection
 * without relying on focus heuristics or private editor fields.
 */
export function selectProgrammaticRange(
	view: EditorView,
	from: number,
	to: number,
): void {
	view.dispatch({
		selection: { anchor: from, head: to },
		effects: programmaticSelectionEffect.of(null),
		scrollIntoView: true,
	});
	view.focus();
}

/** Find the CodeMirror editor associated with an Obsidian Editor instance. */
export function codeMirrorViewForEditor(
	views: Iterable<EditorView>,
	editor: Editor,
): EditorView | null {
	for (const view of views) {
		if (markdownInfo(view.state)?.editor === editor) return view;
	}
	return null;
}

/**
 * Only a selection transaction while the editor still owns focus is a user
 * selection observation. In particular, blur into the composer must not turn
 * an existing range into a synthetic collapsed-caret event.
 */
export function shouldObserveMarkdownSelection(
	update: Pick<MarkdownSelectionUpdate, "selectionSet" | "focusChanged" | "hasFocus" | "userSelection" | "userEdit" | "programmaticSelection">,
): boolean {
	return shouldObserveSelectionUpdate(update);
}

function markdownInfo(state: EditorState): { editor: Editor; filePath: string } | null {
	const info = state.field(editorInfoField, false);
	if (!info?.editor || !info.file) return null;
	return { editor: info.editor, filePath: info.file.path };
}

function decorationsFor(state: EditorState, selection: SelectionAttachment | null): DecorationSet {
	if (!selection) return Decoration.none;
	const info = markdownInfo(state);
	if (!info || info.filePath !== selection.filePath) return Decoration.none;

	const from = offsetOf(state, selection.from);
	const to = offsetOf(state, selection.to);
	if (from === null || to === null || from >= to) return Decoration.none;
	if (state.sliceDoc(from, to) !== selection.text) return Decoration.none;
	return Decoration.set([Decoration.mark({ class: "wb-attached-selection" }).range(from, to)]);
}

function nativeSelectionNeedsHiding(state: EditorState, selection: SelectionAttachment | null): boolean {
	const ranges = state.selection.ranges;
	const hasNativeSelection = ranges.some((range) => !range.empty);
	if (!hasNativeSelection) return false;
	if (!selection || ranges.length !== 1) return true;
	const info = markdownInfo(state);
	if (!info || info.filePath !== selection.filePath) return true;
	const from = offsetOf(state, selection.from);
	const to = offsetOf(state, selection.to);
	const native = state.selection.main;
	return shouldHideNativeSelection(
		true,
		from !== null && to !== null && native.from === from && native.to === to && state.sliceDoc(from, to) === selection.text,
	);
}

function isUserEdit(transaction: ViewUpdate["transactions"][number]): boolean {
	return transaction.isUserEvent("input") ||
		transaction.isUserEvent("delete") ||
		transaction.isUserEvent("move") ||
		transaction.isUserEvent("undo") ||
		transaction.isUserEvent("redo");
}

function offsetOf(state: EditorState, position: DocPosition): number | null {
	if (position.line < 0 || position.line >= state.doc.lines || position.ch < 0) return null;
	const line = state.doc.line(position.line + 1);
	if (position.ch > line.length) return null;
	return line.from + position.ch;
}
