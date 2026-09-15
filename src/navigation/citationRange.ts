import { contentRevision } from "../context/revision";
import { comparePositions, isPositionInBounds, type EditorLike } from "../editing/editor";
import type { DocRange } from "../types";

export type ExactCitationRange =
	| { kind: "legacy" }
	| { kind: "stale" }
	| { kind: "exact"; range: DocRange };

/**
 * Resolve new persisted citations only when their complete source revision is
 * unchanged. Legacy citations have no content revision and keep the existing
 * anchor-based navigation path.
 */
export function resolveExactCitationRange(
	editor: Pick<EditorLike, "getValue" | "getLine" | "lineCount">,
	citation: { range?: DocRange; revision?: string },
): ExactCitationRange {
	if (!citation.range || !citation.revision) return { kind: "legacy" };
	if (contentRevision(editor.getValue()) !== citation.revision) return { kind: "stale" };
	for (const position of [citation.range.from, citation.range.to]) {
		if (!Number.isSafeInteger(position.line) || !Number.isSafeInteger(position.ch)) return { kind: "stale" };
	}
	if (!isPositionInBounds(editor as EditorLike, citation.range.from) ||
		!isPositionInBounds(editor as EditorLike, citation.range.to)) return { kind: "stale" };
	if (comparePositions(citation.range.from, citation.range.to) > 0) return { kind: "stale" };
	return { kind: "exact", range: citation.range };
}

export interface ExactCitationNavigationPort {
	begin(): unknown;
	open(path: string): Promise<EditorLike | null>;
	isCurrent(target: unknown): boolean;
	select(editor: EditorLike, range: DocRange): boolean;
	finish(target: unknown, editor: EditorLike, path: string, selected: boolean): Promise<void> | void;
	cancel(target: unknown): void;
	stale(path: string): void;
}

/** Execute the exact/stale branch used by new persisted Full citations. */
export async function revealExactCitation(
	citation: { path: string; range?: DocRange; revision?: string },
	port: ExactCitationNavigationPort,
): Promise<"exact" | "stale" | "legacy" | "missing"> {
	const target = port.begin();
	try {
		const editor = await port.open(citation.path);
		if (!editor || !port.isCurrent(target)) {
			port.cancel(target);
			return "missing";
		}
		const exact = resolveExactCitationRange(editor, citation);
		if (exact.kind === "legacy") {
			port.cancel(target);
			return "legacy";
		}
		if (exact.kind === "stale") {
			port.cancel(target);
			port.stale(citation.path);
			return "stale";
		}
		if (comparePositions(exact.range.from, exact.range.to) === 0) {
			// An empty source has a real exact location but no characters to
			// select. Finishing without selection avoids the misleading legacy
			// "passage disappeared" path while still opening the right file.
			await port.finish(target, editor, citation.path, false);
			return "exact";
		}
		const selected = port.select(editor, exact.range);
		await port.finish(target, editor, citation.path, selected);
		return "exact";
	} catch (error) {
		port.cancel(target);
		throw error;
	}
}
