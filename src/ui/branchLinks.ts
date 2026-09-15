/**
 * Branch navigation *inside* a conversation.
 *
 * The history modal draws the whole forest. This is the other half: while you
 * are reading one conversation you need to know where it split, and how to get
 * back to where it split *from*. Both answers come from `branchedFrom`, which is
 * already persisted, so no schema changes and no new bookkeeping.
 *
 * Only **direct** relatives are ever surfaced here. Rendering grandchildren
 * inline would turn a transcript into a tree diagram, and the modal already
 * exists for people who want the tree.
 */

import type { ConversationSession } from "../types";

/**
 * Direct children of a conversation, grouped by the message they branched from.
 *
 * Keyed by `messageIndex` so the marker can be dropped in at the exact point in
 * the transcript where the split happened, rather than lumped at the end.
 */
export function directChildBranches(
	sessions: ConversationSession[],
	sessionId: string,
): Map<number, ConversationSession[]> {
	const grouped = new Map<number, ConversationSession[]>();

	for (const session of sessions) {
		const origin = session.branchedFrom;
		if (!origin || origin.sessionId !== sessionId) continue;
		const list = grouped.get(origin.messageIndex) ?? [];
		list.push(session);
		grouped.set(origin.messageIndex, list);
	}

	for (const list of grouped.values()) {
		// Most recently touched first, matching how history orders siblings.
		list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}

	return grouped;
}

/** Total direct children, across all branch points. */
export function directChildCount(sessions: ConversationSession[], sessionId: string): number {
	let count = 0;
	for (const list of directChildBranches(sessions, sessionId).values()) count += list.length;
	return count;
}

/**
 * The conversation this one was branched from.
 *
 * Null when there is no parent, or when the parent is gone — a branch whose
 * origin was deleted is a root, not an error.
 */
export function parentSession(
	sessions: ConversationSession[],
	session: ConversationSession | null,
): ConversationSession | null {
	const parentId = session?.branchedFrom?.sessionId;
	if (!parentId) return null;
	return sessions.find((candidate) => candidate.id === parentId) ?? null;
}
