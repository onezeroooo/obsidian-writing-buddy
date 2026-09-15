import type { ConversationMessage, SelectionAttachment } from "../types";
import { previewOf } from "../util/text";

/** Historical selection text stays useful without replaying whole passages. */
const HISTORY_SELECTION_PREVIEW_CHARS = 80;

/** Text a persisted message contributes to future conversation semantics. */
export function conversationMessageText(message: ConversationMessage): string {
	if (!message.candidate) return message.text;
	const label = message.candidate.kind === "continue" ? "续写候选" : "改写候选";
	return message.text.trim()
		? `${message.text}\n\n${label}：\n${message.candidate.replacement}`
		: `${label}：\n${message.candidate.replacement}`;
}

export interface SelectionReferentOptions {
	/**
	 * The passage this message referred to is provably no longer in the
	 * document. Quoting it would put prose the writer already replaced in front
	 * of the model with nothing marking it as superseded.
	 */
	superseded?: boolean;
}

/**
 * Text a historical message contributes to model conversation semantics.
 *
 * A per-turn selection snapshot is a referent, not another context document.
 * Keep it small so a long passage is not replayed on every follow-up. When the
 * historical snapshot is still the active selection, the current request will
 * already carry its complete text through the normal selection channel, so the
 * history needs only to point at it. Paths are deliberately absent: old or
 * hand-built in-memory sessions must not be able to expose an absolute path.
 */
export function conversationMessageWithSelectionReferent(
	message: ConversationMessage,
	activeSelection?: SelectionAttachment,
	previousSelection?: SelectionAttachment,
	options?: SelectionReferentOptions,
): string {
	const text = conversationMessageText(message);
	if (!message.selection) return text;

	const range = selectionRangeLabel(message.selection);
	const referent = sameSelectionSnapshot(message.selection, activeSelection)
		? `【本条关联选区 · ${range} · 与当前选区相同${unadoptedNote(message)}】`
		: options?.superseded
			? `【本条关联选区 · ${range} · ${supersededNote(message)}】`
			: sameSelectionSnapshot(message.selection, previousSelection)
				? `【本条关联选区 · ${range} · 与上一条相同】`
				: `【本条关联选区 · ${range} · 摘录：${previewOf(message.selection.text, HISTORY_SELECTION_PREVIEW_CHARS)}】`;
	return text.trim().length > 0 ? `${text}\n\n${referent}` : referent;
}

/**
 * The mirror of `supersededNote`, proved the opposite way.
 *
 * A replayed candidate whose selection snapshot still equals the *current*
 * selection is a rejected draft: the writer is pointing at the same passage
 * again, and its text is still the original — had the candidate been applied,
 * the passage would read as the candidate and the snapshots could not match.
 * Without this note the draft sits in history as an ordinary assistant answer,
 * and on an identical repeated ask the statistically best reply is to repeat
 * it; measured on the real vault, a pressed 润色 returned a two-turn-old
 * proposal byte for byte. The candidate text itself is still replayed in
 * full — "上一版太软了" needs it — the note only flips what it exemplifies.
 *
 * A continuation is exempt: it inserts after the selection, so an unchanged
 * selection proves nothing about whether it was adopted.
 */
function unadoptedNote(message: ConversationMessage): string {
	return message.candidate && message.candidate.kind !== "continue"
		? " · 该候选稿未被作者采用，正文仍是原文；不要复用这一稿的措辞、句式或结构，换一种处理"
		: "";
}

/**
 * Say that the passage is gone, and — when this turn also replayed a candidate
 * — that the candidate describes prose which no longer exists either. The
 * candidate text itself is kept: a follow-up like "上一版太软了" needs it, and a
 * candidate the writer applied has become the manuscript.
 */
function supersededNote(message: ConversationMessage): string {
	return message.candidate
		? "该段已被作者修改；上方候选稿仅供参考，以当前正文为准"
		: "该段已被作者修改，以当前正文为准";
}

export type HistoricalSelectionIntent = "none" | "prior" | "compare";

export interface HistoricalSelectionMatch {
	/** Defensive copy of the complete selection, suitable for a context channel. */
	selection: SelectionAttachment;
	messageId: string;
	messageIndex: number;
	relation: "prior" | "comparison";
	/** User-authored request that originally attached this selection, when known. */
	userRequest: string;
}

/**
 * Detect an explicit reference to an earlier selection. Chapter/version language
 * alone is intentionally insufficient: "上一章" is cross-file intent, not a
 * request to replay a prior selected passage.
 */
export function historicalSelectionIntent(query: string): HistoricalSelectionIntent {
	const normalised = query.normalize("NFKC");
	const selectionNoun = /(?:选区|所选(?:文字|文本|内容|段落)?|选中(?:的)?(?:文字|文本|内容|段落)?|圈出(?:的)?(?:文字|文本|内容|段落)?|selection|selected (?:text|passage|paragraph|sentence))/iu;
	const passageReferent = /(?:(?:刚才|之前|前面|上(?:一|个)次|先前|前一轮)(?:那|这|的)?(?:段|句|处|部分|选区)|(?:那|这)(?:段|句|处)(?:之前|刚才)?(?:选中|所选)?(?:的)?(?:文字|内容)?|previous(?:ly)? selected (?:text|passage|paragraph|sentence)|(?:selection|passage|paragraph|sentence) from (?:before|earlier|last time))/iu;
	const historical = /(?:刚才|之前|前面|上(?:一|个)次|上一个|上个|先前|前一轮|历史|prior|previous|earlier|before|last time)/iu;
	const refersToHistoricalSelection = passageReferent.test(normalised) ||
		(selectionNoun.test(normalised) && historical.test(normalised));
	if (!refersToHistoricalSelection) return "none";
	const explicitComparison = /(?:比较|对比|比对|对照|区别|差异|一起看|两段|二者|versus|\bvs\.?\b|compare|comparison|difference|both selections?)/iu;
	const currentAndPrior = /(?:(?:当前|现在|本次|这(?:段|句|处)|当前选区).{0,16}(?:和|与).{0,24}(?:之前|刚才|先前|历史|上(?:一|个)次)|(?:之前|刚才|先前|历史|上(?:一|个)次).{0,24}(?:和|与).{0,16}(?:当前|现在|本次|这(?:段|句|处)|当前选区))/iu;
	return explicitComparison.test(normalised) || currentAndPrior.test(normalised) ? "compare" : "prior";
}

/**
 * Return full, structured selection snapshots only when the current ask names
 * historical selection context. Results are deterministic and newest-first. A
 * comparison starts with the current selection, followed by the newest distinct
 * historical selection; a prior reference returns only that historical value.
 */
export function selectHistoricalSelections(
	messages: readonly ConversationMessage[],
	query: string,
	activeSelection?: SelectionAttachment,
): HistoricalSelectionMatch[] {
	const intent = historicalSelectionIntent(query);
	if (intent === "none") return [];

	const historical = historicalUserSelections(messages).filter((match) =>
		!activeSelection || !sameSelectionSnapshot(match.selection, activeSelection),
	);
	const latest = historical[0];
	if (intent === "prior") return latest ? [{ ...latest, relation: "prior" }] : [];

	const result: HistoricalSelectionMatch[] = [];
	if (activeSelection) {
		result.push({
			selection: copySelection(activeSelection),
			messageId: "current-selection",
			messageIndex: messages.length,
			relation: "comparison",
			userRequest: query,
		});
	}
	if (latest) result.push({ ...latest, relation: "comparison" });
	return result;
}

function historicalUserSelections(messages: readonly ConversationMessage[]): HistoricalSelectionMatch[] {
	const result: HistoricalSelectionMatch[] = [];
	const seen: SelectionAttachment[] = [];
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role !== "user" || !message.selection) continue;
		if (seen.some((selection) => sameSelectionSnapshot(selection, message.selection))) continue;
		seen.push(message.selection);
		result.push({
			selection: copySelection(message.selection),
			messageId: message.id,
			messageIndex: index,
			relation: "prior",
			userRequest: message.text,
		});
	}
	return result;
}

function copySelection(selection: SelectionAttachment): SelectionAttachment {
	return {
		...selection,
		from: { ...selection.from },
		to: { ...selection.to },
	};
}

function selectionRangeLabel(selection: SelectionAttachment): string {
	const from = `${selection.from.line + 1}:${selection.from.ch + 1}`;
	const to = `${selection.to.line + 1}:${selection.to.ch + 1}`;
	return `行列 ${from}–${to}`;
}

export function sameSelectionSnapshot(
	left: SelectionAttachment,
	right: SelectionAttachment | undefined,
): boolean {
	return right !== undefined &&
		left.filePath === right.filePath &&
		left.text === right.text &&
		left.from.line === right.from.line &&
		left.from.ch === right.from.ch &&
		left.to.line === right.to.line &&
		left.to.ch === right.to.ch;
}
