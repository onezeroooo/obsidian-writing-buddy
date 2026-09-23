/**
 * Novel knowledge as a piece of evidence the model can read and cite.
 *
 * The adapter returns knowledge by kind, already filtered to the story
 * position and point of view of the turn. This renders it as one `memory`
 * evidence item in the same shape every other piece of context takes, so
 * the research controller, the citation rules and the message view treat it
 * like any other admitted source. Kinds appear in authority order; a
 * contradiction is stated as one, next to the knowledge it disagrees with.
 */

import type { EvidenceItem } from "../context/evidence";
import { instructionLocale } from "../i18n";
import { novelPaths } from "./NovelKnowledgeStore";
import { type NovelKnowledgeKind, barePredicate } from "./novelKinds";
import type { NovelContext, NovelKnowledgeEntry } from "./WritingBuddyRecantaAdapter";

const KIND_LABELS: Record<NovelKnowledgeKind, { zh: string; en: string }> = {
	"explicit-correction": { zh: "作者更正", en: "Author corrections" },
	"author-canon": { zh: "作者设定", en: "Author canon" },
	"narrative-state": { zh: "当前叙事状态", en: "Current narrative state" },
	"manuscript-event": { zh: "正文事件", en: "Manuscript events" },
	"relationship-trajectory": { zh: "关系走向", en: "Relationship trajectory" },
	"open-thread": { zh: "线索", en: "Threads" },
	"pov-knowledge": { zh: "视角人物所知", en: "Point-of-view knowledge" },
	"derived-observation": { zh: "推断观察", en: "Derived observations" },
};

export function novelEvidencePath(): string {
	return `${novelPaths.dir}/knowledge.md`;
}

/** Render the context as prose lines; empty when there is nothing worth saying. */
export function renderNovelContextText(context: NovelContext): string {
	const en = instructionLocale() === "en";
	const lines: string[] = [];
	const byKind = new Map<NovelKnowledgeKind, NovelKnowledgeEntry[]>();
	for (const entry of context.entries) {
		const list = byKind.get(entry.kind) ?? [];
		list.push(entry);
		byKind.set(entry.kind, list);
	}
	for (const [kind, entries] of byKind) {
		const label = KIND_LABELS[kind];
		lines.push(`## ${en ? label.en : label.zh}`);
		for (const entry of entries) lines.push(`- ${entryLine(entry, en)}`);
		lines.push("");
	}
	if (context.contradictions.length > 0) {
		lines.push(`## ${en ? "Contradictions" : "矛盾"}`);
		for (const item of context.contradictions) {
			const higher = KIND_LABELS[item.stated.kind];
			const lower = KIND_LABELS[item.contradicted.kind];
			lines.push(en
				? `- ${item.subject} · ${item.predicate}: ${higher.en} says ${valuesText(item.stated.values)}; ${lower.en} says ${valuesText(item.contradicted.values)}. The higher authority stands.`
				: `- ${item.subject} · ${item.predicate}：${higher.zh}为 ${valuesText(item.stated.values)}；${lower.zh}为 ${valuesText(item.contradicted.values)}。以更高权威为准。`);
		}
		lines.push("");
	}
	if (context.evidence.length > 0) {
		lines.push(`## ${en ? "Supporting passages" : "支持段落"}`);
		for (const item of context.evidence.slice(0, 8)) {
			const where = item.position ? (en ? ` (chapter order ${item.position.ordinal + 1}, part ${item.position.chunk + 1})` : `（第 ${item.position.ordinal + 1} 篇，第 ${item.position.chunk + 1} 段）`) : "";
			lines.push(`- ${item.text.replace(/\s+/gu, " ").trim().slice(0, 400)}${where}`);
		}
		lines.push("");
	}
	const notes: string[] = [];
	if (context.withheldPrivate > 0) notes.push(en ? `${context.withheldPrivate} item(s) known only to other characters were withheld.` : `已隐去 ${context.withheldPrivate} 条仅其他人物知晓的内容。`);
	if (!context.ready) notes.push(en ? "Some chapters are still being processed; knowledge may be incomplete." : "部分章节仍在处理中，知识可能不完整。");
	if (notes.length) lines.push(notes.join(" "));
	return lines.join("\n").trim();
}

/** The evidence item the context path attaches, or null when nothing was recalled. */
export function novelContextEvidence(context: NovelContext): EvidenceItem | null {
	const text = renderNovelContextText(context);
	if (!text) return null;
	const en = instructionLocale() === "en";
	return {
		id: "",
		path: novelEvidencePath(),
		name: en ? "Manuscript knowledge" : "作品知识",
		kind: "memory",
		heading: null,
		label: en ? "Manuscript knowledge" : "作品知识",
		excerpt: text,
		anchorText: text.split("\n")[0] ?? "",
		truncated: false,
	};
}

function entryLine(entry: NovelKnowledgeEntry, en: boolean): string {
	const bare = barePredicate(entry.predicate);
	const predicate = bare || (entry.predicate.startsWith("believes") ? (en ? "believes" : "以为") : entry.predicate.startsWith("knows") ? (en ? "knows" : "知道") : entry.predicate);
	const current = entry.values.length ? valuesText(entry.values) : en ? "(unresolved)" : "（未定）";
	const value = entry.history?.length
		? `${entry.history.map((step) => valuesText(step.values)).join(" → ")} → ${current}`
		: current;
	const status = entry.status === "conflict" ? (en ? " [conflicting sources]" : "［来源冲突］") : entry.status === "needs_review" ? (en ? " [source changed]" : "［来源已变更］") : "";
	const where = entry.position ? (en ? ` — as of chapter order ${entry.position.ordinal + 1}` : ` — 截至第 ${entry.position.ordinal + 1} 篇`) : "";
	return `${entry.subject} · ${predicate}: ${value}${status}${where}`;
}

function valuesText(values: readonly string[]): string {
	return values.length ? values.join(" / ") : "—";
}
