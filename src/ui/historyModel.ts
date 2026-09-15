/**
 * The logic behind the conversation navigator, with no DOM in it.
 *
 * History has to do four things that are easy to get subtly wrong — build a
 * branch forest, group it by recency, search it, and page it — so all four live
 * here as pure functions over the sessions already in memory. The modal is then
 * a thin renderer, and every rule below is testable without Obsidian.
 *
 * Nothing here reads or writes files. `SessionManager` has already loaded the
 * complete persisted history, so search covers everything on disk, not merely
 * the rows currently rendered.
 */

import { t } from "../i18n";
import type { ConversationSession } from "../types";
import { conversationMessageText } from "../session/messageText";

/** One conversation and the branches taken from it. */
export interface HistoryNode {
	session: ConversationSession;
	depth: number;
	children: HistoryNode[];
	/** Index in the parent transcript this branch was taken from. */
	branchPoint?: number;
}

export interface HistoryGroup {
	/** `今天`, `昨天`, `过去 7 天`, `过去 30 天`, `更早`. */
	label: string;
	roots: HistoryNode[];
}

/**
 * Assemble sessions into a forest using the `branchedFrom` metadata that is
 * already persisted. No schema change is needed for the tree.
 *
 * A branch whose parent is missing — deleted, or not yet synced from another
 * device — becomes a root rather than disappearing. Losing a parent must never
 * lose the child.
 */
export function buildForest(sessions: ConversationSession[]): HistoryNode[] {
	const byId = new Map(sessions.map((session) => [session.id, session]));
	const nodes = new Map<string, HistoryNode>(
		sessions.map((session) => [session.id, { session, depth: 0, children: [] }]),
	);

	const roots: HistoryNode[] = [];
	for (const session of sessions) {
		const node = nodes.get(session.id);
		if (!node) continue;

		const parentId = session.branchedFrom?.sessionId;
		const parent = parentId ? nodes.get(parentId) : undefined;

		// A cycle would only arise from hand-edited files, but it would hang the
		// renderer, so treat any self-reachable parent as absent.
		if (parent && parentId && byId.has(parentId) && !createsCycle(session.id, parentId, byId)) {
			if (session.branchedFrom) node.branchPoint = session.branchedFrom.messageIndex;
			parent.children.push(node);
		} else {
			roots.push(node);
		}
	}

	const newestFirst = (a: HistoryNode, b: HistoryNode) =>
		latestActivity(b).localeCompare(latestActivity(a));

	const assignDepth = (node: HistoryNode, depth: number): void => {
		node.depth = depth;
		node.children.sort(newestFirst);
		for (const child of node.children) assignDepth(child, depth + 1);
	};

	roots.sort(newestFirst);
	for (const root of roots) assignDepth(root, 0);
	return roots;
}

/** Would treating `parentId` as the parent of `id` close a loop? */
function createsCycle(id: string, parentId: string, byId: Map<string, ConversationSession>): boolean {
	let cursor: string | undefined = parentId;
	const seen = new Set<string>();
	while (cursor) {
		if (cursor === id) return true;
		if (seen.has(cursor)) return true;
		seen.add(cursor);
		cursor = byId.get(cursor)?.branchedFrom?.sessionId;
	}
	return false;
}

/**
 * The most recent activity anywhere in a tree.
 *
 * Deliberately not the root's own `updatedAt`. Branching and then working only
 * in the branch leaves the root's timestamp frozen, which would sink an
 * actively-used conversation into `更早` while the writer is still in it. Taking
 * the maximum across the tree keeps branches under their root and still stops
 * them from drifting into a different group on their own.
 */
export function latestActivity(node: HistoryNode): string {
	let latest = node.session.updatedAt;
	for (const child of node.children) {
		const childLatest = latestActivity(child);
		if (childLatest > latest) latest = childLatest;
	}
	return latest;
}

/** Every session in a tree, root first. */
export function flatten(node: HistoryNode): HistoryNode[] {
	return [node, ...node.children.flatMap(flatten)];
}

/** Total conversations in a tree, including the root. */
export function treeSize(node: HistoryNode): number {
	return 1 + node.children.reduce((sum, child) => sum + treeSize(child), 0);
}

// ---------------------------------------------------------------------------
// Recency grouping
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Group roots into 今天 / 昨天 / 过去 7 天 / 过去 30 天 / 更早.
 *
 * Boundaries are calendar days in local time, not rolling 24-hour windows:
 * something from 23:00 yesterday belongs in 昨天, not in 今天 because it happens
 * to be within the last few hours.
 */
export function groupByRecency(roots: HistoryNode[], now: Date = new Date()): HistoryGroup[] {
	const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

	const buckets: Array<{ label: string; min: number; roots: HistoryNode[] }> = [
		{ label: t("history.groupToday"), min: startOfToday, roots: [] },
		{ label: t("history.groupYesterday"), min: startOfToday - DAY_MS, roots: [] },
		{ label: t("history.group7Days"), min: startOfToday - 7 * DAY_MS, roots: [] },
		{ label: t("history.group30Days"), min: startOfToday - 30 * DAY_MS, roots: [] },
		{ label: t("history.groupEarlier"), min: Number.NEGATIVE_INFINITY, roots: [] },
	];

	for (const root of roots) {
		const when = Date.parse(latestActivity(root));
		const stamp = Number.isNaN(when) ? 0 : when;
		const bucket = buckets.find((candidate) => stamp >= candidate.min) ?? buckets[buckets.length - 1];
		bucket.roots.push(root);
	}

	return buckets
		.filter((bucket) => bucket.roots.length > 0)
		.map((bucket) => ({ label: bucket.label, roots: bucket.roots }));
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchHit {
	sessionId: string;
	/** Where the match was found, for the result subtitle. */
	field: "title" | "message" | "file" | "skill";
	/** A short excerpt around the match, already truncated. */
	excerpt: string;
}

/**
 * Search every loaded conversation.
 *
 * Covers titles, message text, attached file names, and skill ids. Matching is
 * case-insensitive substring: Chinese has no word boundaries to tokenize on, so
 * substring is both the simplest and the most predictable rule for a writer
 * looking for a phrase they remember typing.
 */
export function searchSessions(sessions: ConversationSession[], rawQuery: string): Map<string, SearchHit> {
	const query = rawQuery.trim().toLowerCase();
	const hits = new Map<string, SearchHit>();
	if (query.length === 0) return hits;

	for (const session of sessions) {
		if (session.title.toLowerCase().includes(query)) {
			hits.set(session.id, { sessionId: session.id, field: "title", excerpt: session.title });
			continue;
		}

		let found: SearchHit | undefined;
		for (const message of session.messages) {
			const searchable = conversationMessageText(message);
			const index = searchable.toLowerCase().indexOf(query);
			if (index !== -1) {
				found = { sessionId: session.id, field: "message", excerpt: excerptAround(searchable, index, query.length) };
				break;
			}
			const fileName = message.selection?.fileName;
			if (fileName && fileName.toLowerCase().includes(query)) {
				found = { sessionId: session.id, field: "file", excerpt: fileName };
				break;
			}
			if (message.skillId && message.skillId.toLowerCase().includes(query)) {
				found = { sessionId: session.id, field: "skill", excerpt: message.skillId };
				break;
			}
		}

		if (!found) {
			const related = session.relatedFiles.find((path) => path.toLowerCase().includes(query));
			if (related) found = { sessionId: session.id, field: "file", excerpt: related };
		}

		if (found) hits.set(session.id, found);
	}

	return hits;
}

/** A window of text around a match, so the writer can see the context. */
export function excerptAround(text: string, index: number, length: number, radius = 24): string {
	const characters = Array.from(text.replace(/\s+/g, " "));
	// `index` is a UTF-16 offset; convert it to a code-point offset so CJK and
	// emoji do not shift the window.
	const prefixPoints = Array.from(text.slice(0, index).replace(/\s+/g, " ")).length;
	const matchPoints = Array.from(text.substr(index, length)).length;

	const start = Math.max(0, prefixPoints - radius);
	const end = Math.min(characters.length, prefixPoints + matchPoints + radius);
	const body = characters.slice(start, end).join("").trim();

	return `${start > 0 ? "…" : ""}${body}${end < characters.length ? "…" : ""}`;
}

/**
 * Keep only trees containing a match, pruning branches that do not.
 *
 * A matching branch keeps its ancestors even when they do not match, so a
 * nested result is never shown as an orphan with no indication of where it
 * belongs.
 */
export function filterForest(roots: HistoryNode[], matches: Map<string, SearchHit>): HistoryNode[] {
	const prune = (node: HistoryNode): HistoryNode | null => {
		const children = node.children.map(prune).filter((child): child is HistoryNode => child !== null);
		const selfMatches = matches.has(node.session.id);
		if (!selfMatches && children.length === 0) return null;
		return { ...node, children };
	};

	return roots.map(prune).filter((root): root is HistoryNode => root !== null);
}

// ---------------------------------------------------------------------------
// Incremental loading
// ---------------------------------------------------------------------------

/** How many root conversations are rendered before the writer asks for more. */
export const HISTORY_PAGE_SIZE = 40;

export interface Page<T> {
	items: T[];
	shown: number;
	total: number;
	hasMore: boolean;
}

/**
 * Take the first `count` roots.
 *
 * History grows without bound, so the modal renders a window and extends it on
 * demand rather than building a DOM node per conversation on open. This is a
 * rendering limit only — search always runs over the complete set.
 */
export function pageRoots(roots: HistoryNode[], count: number): Page<HistoryNode> {
	const shown = Math.max(0, Math.min(count, roots.length));
	return {
		items: roots.slice(0, shown),
		shown,
		total: roots.length,
		hasMore: shown < roots.length,
	};
}
