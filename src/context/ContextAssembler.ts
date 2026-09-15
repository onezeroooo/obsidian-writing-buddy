/**
 * Assembling the context for one turn, from the local vault.
 *
 * Priority order is fixed, and the budget is spent in that order:
 *
 *   1. the selection, and the prose immediately around it
 *   2. the live active editor
 *
 * Cross-file evidence is never selected here. Bounded research starts from this
 * deterministic local state, then lets the Agent search and read through the
 * separately bounded ResearchRetriever.
 */

import { countChars, truncateChars } from "../util/text";
import type {
	AssembledContext,
	ContextBudget,
	ContextDocument,
	ContextPlan,
	ContextSelection,
	VaultReader,
} from "./types";
import { DEFAULT_CONTEXT_BUDGET } from "./types";
import { planContext } from "./ContextPlanner";

export interface AssembleOptions {
	/** The writer's question or instruction, used only to derive the local plan. */
	query: string;
	/** The captured passage, when the action has one. */
	selection?: {
		filePath: string;
		text: string;
		from: { line: number; ch: number };
		to: { line: number; ch: number };
		before?: string;
		after?: string;
	};
	conversationMessages?: number;
	skillId?: string;
	budget?: ContextBudget;
	plan?: ContextPlan;
	/** Cooperative cancellation around local assembly. */
	signal?: AbortSignal;
}

export class ContextAssemblyCancelledError extends Error {
	constructor() {
		super("Context assembly cancelled");
		this.name = "ContextAssemblyCancelledError";
	}
}

/** Protects explicit Full from degrading to the ordinary bounded assembler. */
export class FullCorpusWorkflowRequiredError extends Error {
	constructor() {
		super("Full context requires the full-current-manuscript workflow");
		this.name = "FullCorpusWorkflowRequiredError";
	}
}

export function isContextAssemblyCancelled(error: unknown): error is ContextAssemblyCancelledError {
	return error instanceof ContextAssemblyCancelledError ||
		(error instanceof DOMException && error.name === "AbortError") ||
		(error instanceof Error && error.name === "AbortError");
}

export class ContextAssembler {
	constructor(private readonly reader: VaultReader) {}

	async assemble(options: AssembleOptions): Promise<AssembledContext> {
		throwIfAssemblyCancelled(options.signal);
		const planned = options.plan ?? planContext({
			query: options.query,
			selectionChars: options.selection ? countChars(options.selection.text) : 0,
		});
		if (planned.blockingReason || planned.execution === "full-current-manuscript") {
			throw new FullCorpusWorkflowRequiredError();
		}
		const budget = options.budget ?? planned.budget ?? DEFAULT_CONTEXT_BUDGET;
		const activePath = this.reader.activeFilePath() ?? options.selection?.filePath ?? null;

		const documents: ContextDocument[] = [];
		const omitted: string[] = [];
		const seenPaths = new Set<string>();
		const seenContent: string[] = [];
		let rawChars = 0;
		let deduplicatedChars = 0;
		let truncatedSources = 0;
		let remaining = budget.totalChars;

		/** Add a document if the budget allows, truncating as needed. */
		const push = (
			path: string,
			role: ContextDocument["role"],
			text: string,
			cap = budget.perDocumentChars,
			revision: ContextDocument["revision"] = "saved",
			preserve = false,
			alreadyTruncated = false,
			sourceChars?: number,
		): boolean => {
			if (text.trim().length === 0) return false;
			const originalSize = countChars(text);
			rawChars += sourceChars ?? originalSize;
			const deduplicated = removeKnownContent(text, seenContent);
			const withoutKnownText = deduplicated.text;
			deduplicatedChars += deduplicated.removedChars;
			const size = countChars(withoutKnownText);
			const fingerprint = normalizeForDedup(withoutKnownText);
			if (seenPaths.has(path) || isDuplicateContent(fingerprint, seenContent)) {
				deduplicatedChars += size;
				return false;
			}
			if (!fingerprint) return false;
			if (remaining <= 0) {
				omitted.push(path);
				return false;
			}
			// Preserving a chapter summary bypasses the per-document cap, never the
			// request's total budget.
			const allowance = preserve ? Math.min(size, remaining) : Math.min(cap, remaining);
			// `truncateChars` appends an ellipsis, which also costs a character —
			// so leave room for it, or a truncated document overruns the budget by
			// exactly one.
			const kept = size <= allowance ? withoutKnownText : truncateWithin(withoutKnownText, allowance);
			const truncated = alreadyTruncated || size > allowance;
			if (truncated) truncatedSources += 1;
			documents.push({ path, role, text: kept, truncated, revision });
			seenPaths.add(path);
			seenContent.push(normalizeForDedup(kept));
			remaining -= countChars(kept);
			return true;
		};

		// --- 1. the selection and its surroundings ---------------------------
		//
		// A captured selection and its neighbours come from the same editor
		// snapshot. Cross-file source choices belong to Agent research.
		let selection: ContextSelection | null = null;
		let surroundingChars = 0;

		if (options.selection) {
			const selectionLiveText = this.liveTextFor(options.selection.filePath);
			const located = this.surroundings(
				selectionLiveText,
				options.selection.text,
				options.selection.from,
				options.selection.to,
				budget.surroundingChars,
			);
			const surrounding = {
				before: located.before || options.selection.before || "",
				after: located.after || options.selection.after || "",
			};
			surroundingChars = countChars(surrounding.before) + countChars(surrounding.after);
			selection = {
				filePath: options.selection.filePath,
				text: options.selection.text,
				from: options.selection.from,
				to: options.selection.to,
				before: surrounding.before,
				after: surrounding.after,
			};
			remaining -= countChars(options.selection.text);
			remaining -= surroundingChars;
			for (const piece of [options.selection.text, surrounding.before, surrounding.after]) {
				const normalized = normalizeForDedup(piece);
				if (normalized) seenContent.push(normalized);
			}
		}

		// --- 2. the active file ---------------------------------------------
		if (planned.includeActiveFile && activePath) {
			const live = this.liveTextFor(activePath);
			let source: { text: string; revision: "saved" | "editor" } | null = live !== null
				? { text: live, revision: "editor" }
				: null;
			if (!source) {
				try {
					throwIfAssemblyCancelled(options.signal);
					source = { text: await this.reader.read(activePath), revision: "saved" };
					throwIfAssemblyCancelled(options.signal);
				} catch (error) {
					if (options.signal?.aborted || isContextAssemblyCancelled(error)) throw new ContextAssemblyCancelledError();
				}
			}
			if (source) {
				const activeCap = budget.perDocumentChars;
				const activeSelection = options.selection?.filePath === activePath ? options.selection : undefined;
				const focus = planned.preserveActiveFile
					? { text: removeExactSelectionRange(source.text, activeSelection).text, truncated: false }
					: activeFilePassage(
						 source.text,
						 activeCap,
						 activeSelection,
						 source.revision === "editor" ? this.reader.activeFileCursorOffset?.() ?? null : null,
					);
				push(
					activePath,
					"active-file",
					focus.text,
					activeCap,
					source.revision,
					planned.preserveActiveFile,
					focus.truncated,
					countChars(source.text),
				);
			}
		}
		throwIfAssemblyCancelled(options.signal);

		const selectionChars = options.selection ? countChars(options.selection.text) : 0;
		const activeFileChars = documents
			.filter((document) => document.role === "active-file")
			.reduce((sum, document) => sum + countChars(document.text), 0);
		const retrievedChars = documents
			.filter((document) => document.role !== "active-file")
			.reduce((sum, document) => sum + countChars(document.text), 0);
		const documentChars = activeFileChars + retrievedChars;
		const finalChars = selectionChars + surroundingChars + documentChars;
		const revisions = new Set(documents.map((document) => document.revision));
		if (selection) revisions.add("editor");
		const sourceRevision = revisions.size > 1 ? "mixed" : revisions.has("editor") ? "editor" : "saved";
		return {
			activeFilePath: activePath,
			selection,
			documents,
			charsUsed: finalChars,
			omitted,
			report: {
				mode: planned.mode,
				resolvedDepth: planned.resolvedDepth,
				task: planned.task,
				sourceRevision,
				selectionChars,
				surroundingChars,
				activeFileChars,
				retrievedChars,
				rawChars: selectionChars + surroundingChars + rawChars,
				deduplicatedChars,
				finalChars,
				estimatedTokens: Math.ceil(finalChars / 2),
				includedSources: documents.length + (selection ? 1 : 0) + (surroundingChars > 0 ? 1 : 0),
				excludedArchiveCount: 0,
				truncatedSources,
				omittedSources: omitted.length,
				budgetExpandedForSelection: planned.budgetExpandedForSelection,
				...(options.conversationMessages !== undefined ? { conversationMessages: options.conversationMessages } : {}),
				...(options.skillId ? { skillId: options.skillId } : {}),
			},
		};
	}

	private liveTextFor(path: string | null): string | null {
		if (!path) return null;
		if (this.reader.activeFilePath() === path) {
			const live = this.reader.activeFileText();
			if (live !== null) return live;
		}
		return null;
	}

	/**
	 * The prose either side of the selection.
	 *
	 * Located by exact string match against the live buffer, which is the same
	 * text the selection was captured from. If it cannot be found — the writer
	 * edited in the meantime — the surroundings are simply omitted rather than
	 * guessed at.
	 */
	private surroundings(
		activeText: string | null,
		selected: string,
		from: { line: number; ch: number },
		to: { line: number; ch: number },
		width: number,
	): { before: string; after: string } {
		if (!activeText || selected.length === 0) return { before: "", after: "" };
		const start = offsetAt(activeText, from);
		const end = offsetAt(activeText, to);
		if (start === null || end === null || activeText.slice(start, end) !== selected) return { before: "", after: "" };

		const beforeAll = activeText.slice(0, start);
		const afterAll = activeText.slice(end);

		return {
			before: tailChars(beforeAll, width),
			after: truncateWithin(afterAll, width),
		};
	}
}

function throwIfAssemblyCancelled(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw new ContextAssemblyCancelledError();
}

function normalizeForDedup(text: string): string {
	return text.replace(/\r\n?/g, "\n").trim().replace(/[ \t]+/g, " ");
}

/**
 * Treat a candidate as duplicate when it is the same material, or is wholly
 * contained in a longer piece already attached. Partial overlap is preserved:
 * cutting an arbitrary middle range out of prose would damage continuity more
 * than the saved characters are worth.
 */
function isDuplicateContent(candidate: string, included: string[]): boolean {
	if (!candidate) return true;
	return included.some((existing) => existing === candidate || (candidate.length >= 80 && existing.includes(candidate)));
}

function removeKnownContent(text: string, included: string[]): { text: string; removedChars: number } {
	let result = text;
	let removedChars = 0;
	for (const existing of included) {
		if (existing.length < 80 || !result.includes(existing)) continue;
		const occurrences = result.split(existing).length - 1;
		removedChars += countChars(existing) * occurrences;
		result = result.split(existing).join("\n\n");
	}
	return { text: result.trim(), removedChars };
}

/** Active prose follows the selection, then cursor, then the latest tail. */
function activeFilePassage(
	text: string,
	limit: number,
	selection: AssembleOptions["selection"] | undefined,
	cursorOffset: number | null,
): { text: string; truncated: boolean } {
	const removed = removeExactSelectionRange(text, selection);
	const evidenceText = removed.text;
	let focus: number | null = removed.start;
	const size = countChars(evidenceText);
	if (size <= limit) return { text: evidenceText, truncated: false };
	if (focus === null && cursorOffset !== null && Number.isFinite(cursorOffset)) {
		focus = Math.max(0, Math.min(evidenceText.length, Math.floor(cursorOffset)));
	}
	if (focus === null) return { text: tailChars(evidenceText, limit), truncated: true };
	return { text: windowAt(evidenceText, focus, limit), truncated: true };
}

function removeExactSelectionRange(
	text: string,
	selection: AssembleOptions["selection"] | undefined,
): { text: string; start: number | null } {
	if (!selection) return { text, start: null };
	const start = offsetAt(text, selection.from);
	const end = offsetAt(text, selection.to);
	if (start === null || end === null || end < start || text.slice(start, end) !== selection.text) {
		return { text, start: null };
	}
	return { text: `${text.slice(0, start)}${text.slice(end)}`, start };
}

function windowAt(text: string, utf16Offset: number, limit: number): string {
	const chars = Array.from(text);
	if (limit <= 0) return "";
	if (chars.length <= limit) return text;
	const point = Array.from(text.slice(0, utf16Offset)).length;
	if (limit <= 2) {
		const start = Math.max(0, Math.min(chars.length - limit, point - Math.floor(limit / 2)));
		return chars.slice(start, start + limit).join("");
	}
	const contentLimit = Math.max(1, limit - 2);
	let start = Math.max(0, point - Math.floor(contentLimit / 2));
	let end = Math.min(chars.length, start + contentLimit);
	start = Math.max(0, end - contentLimit);
	return `${start > 0 ? "…" : ""}${chars.slice(start, end).join("")}${end < chars.length ? "…" : ""}`;
}

function offsetAt(text: string, position: { line: number; ch: number }): number | null {
	if (position.line < 0 || position.ch < 0) return null;
	let line = 0;
	let start = 0;
	while (line < position.line) {
		const match = /\r\n|\n|\r/g;
		match.lastIndex = start;
		const next = match.exec(text);
		if (!next) return null;
		start = next.index + next[0].length;
		line += 1;
	}
	const end = /\r|\n/.exec(text.slice(start));
	const lineLength = end ? end.index : text.length - start;
	if (position.ch > lineLength) return null;
	return start + position.ch;
}

/** The last `limit` code points of a string. */
function tailChars(text: string, limit: number): string {
	const characters = Array.from(text);
	if (limit <= 0) return "";
	if (characters.length <= limit) return text;
	if (limit === 1) return "…";
	return `…${characters.slice(characters.length - (limit - 1)).join("")}`;
}

/** Truncate while counting the ellipsis inside the requested hard cap. */
function truncateWithin(text: string, limit: number): string {
	if (limit <= 0) return "";
	if (countChars(text) <= limit) return text;
	if (limit === 1) return "…";
	return truncateChars(text, limit - 1);
}
