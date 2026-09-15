/**
 * Owns the set of conversations and their persistence.
 *
 * Sessions live in the vault, one file each. This class is the only thing that
 * decides when a session is written, so persistence stays predictable: every
 * mutation goes through here, and every mutation persists.
 *
 * Closing a session is not deleting it. A closed session keeps its file and its
 * full transcript and can be reopened; deletion is a separate, explicit act.
 */

import { t } from "../i18n";
import type { ConversationMessage, ConversationSession, SelectionAttachment } from "../types";

/**
 * How many of our own recent revisions stay recognisable as ours.
 *
 * Enough to survive a sync service handing a write back several revisions late,
 * which is ordinary for a large file on a slow link; small enough that it is a
 * constant cost per open session rather than one that grows with the transcript.
 */
const MAX_TRACKED_SELF_WRITES = 8;
import { fingerprintSessionContents, type ProjectStore, type SessionFileReadResult } from "../storage/ProjectStore";
import { CONVERSATION_SCHEMA_VERSION, serializeSession } from "../storage/conversationSchema";
import { createSessionId, nowIso } from "../util/id";
import { truncateChars } from "../util/text";
import { mapWithConcurrency } from "../util/pool";

/** A session plus its depth in the branch tree, for rendering. */
export interface SessionTreeNode {
	session: ConversationSession;
	depth: number;
}

/** Outcome of applying one vault conversation-file event to memory. */
export type ExternalSessionChangeResult =
	| { kind: "created" | "updated"; sessionId: string; session: ConversationSession }
	| { kind: "deleted"; sessionId: string; activeSessionDeleted: boolean }
	| { kind: "renamed"; sessionId: string; previousSessionId: string; session: ConversationSession; activeSessionRenamed: boolean }
	| { kind: "unchanged" | "self-write"; sessionId: string }
	| { kind: "malformed"; sessionId: string; reason: string }
	| {
			kind: "conflict";
			sessionId: string;
			previousSessionId?: string;
			operation: "update" | "delete" | "rename";
			local: ConversationSession;
			external: ConversationSession | null;
		};

export const UNTITLED = "未命名对话";
/** A management threshold, not a hard cap. New conversations remain allowed. */
export const SESSION_RECOMMENDED_LIMIT = 500;

export interface PreservedSessionConflict {
	originalSessionId: string;
	preservedSession: ConversationSession;
	external: ConversationSession | null;
	reason: string;
}

export class SessionManager {
	private sessions = new Map<string, ConversationSession>();
	private activeId: string | null = null;
	private brokenCount = 0;
	private loaded = false;
	/** Last accepted disk state, used as the base revision for conflict checks. */
	private syncedFingerprints = new Map<string, string>();
	/** Fingerprints emitted by our own writes and awaiting vault notifications. */
	/**
	 * Recent write fingerprints per session, newest last.
	 *
	 * Sync can hand a write back to us several revisions late. Remembering only
	 * the newest made our own older content read as a foreign edit, which is one
	 * of the ways an ordinary save became a preserved copy. Bounded so a long
	 * conversation cannot grow this without limit.
	 */
	private pendingSelfWrites = new Map<string, string[]>();
	/**
	 * Where a turn went when a conflict moved it onto a preserved copy.
	 *
	 * The caller ends the turn with the id it started with; without this the
	 * copy keeps an active marker forever, and every later external read for it
	 * is classified as a conflict — which is how a copy acquires its own copy.
	 */
	private readonly remappedTurns = new Map<string, string>();
	private readonly activeLocalTurns = new Set<string>();

	constructor(
		private readonly store: ProjectStore,
		private readonly onWriteConflict: (conflict: PreservedSessionConflict) => void = () => undefined,
	) {}

	/**
	 * Load every session from the vault and choose which one to reopen.
	 *
	 * Restoration order matters more than it looks. Picking "most recently
	 * updated" alone is actively wrong: creating a new session writes a file, so
	 * an empty session created seconds before quitting always sorts first, and
	 * the writer comes back to a blank transcript with their real conversation
	 * still on disk but out of sight. That reads as lost history.
	 *
	 * So: prefer the session this machine actually had open, then the most
	 * recent one that has messages in it, and only then fall back to anything
	 * open at all.
	 */
	async load(preferredActiveId?: string | null): Promise<void> {
		const { sessions, broken } = await this.store.loadAllSessions();
		this.sessions = new Map(sessions.map((session) => [session.id, session]));
		this.syncedFingerprints = new Map(sessions.map((session) => [session.id, fingerprintSession(session)]));
		this.pendingSelfWrites.clear();
		this.brokenCount = broken.length;
		this.loaded = true;

		const remembered = preferredActiveId ? this.sessions.get(preferredActiveId) : undefined;
		if (remembered && !remembered.closed) {
			this.activeId = remembered.id;
			return;
		}

		const open = sessions.filter((session) => !session.closed);
		const withContent = open.find((session) => session.messages.length > 0);
		this.activeId = withContent?.id ?? open[0]?.id ?? null;
	}

	/** False until `load` has completed, so the view can say "loading". */
	get isLoaded(): boolean {
		return this.loaded;
	}

	/** Total sessions known, open and closed. Used for the history affordance. */
	get count(): number {
		return this.sessions.size;
	}

	/**
	 * Every session, newest first.
	 *
	 * History shows all conversations regardless of the `closed` flag. That flag
	 * is retained so older files keep parsing, but it no longer divides the UI
	 * into "current" and "recoverable" — a conversation is just a conversation.
	 */
	all(): ConversationSession[] {
		return [...this.sessions.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}

	get brokenSessionCount(): number {
		return this.brokenCount;
	}

	// --- access ------------------------------------------------------------

	getActive(): ConversationSession | null {
		return this.activeId ? (this.sessions.get(this.activeId) ?? null) : null;
	}

	getActiveId(): string | null {
		return this.activeId;
	}

	get(sessionId: string): ConversationSession | null {
		return this.sessions.get(sessionId) ?? null;
	}

	beginLocalTurn(sessionId: string): void {
		this.remappedTurns.delete(sessionId);
		this.activeLocalTurns.add(sessionId);
	}

	endLocalTurn(sessionId: string): void {
		this.activeLocalTurns.delete(sessionId);
		// Follow the chain: a preserved copy can itself have been preserved.
		const moved = this.remappedTurns.get(sessionId);
		if (moved === undefined) return;
		this.remappedTurns.delete(sessionId);
		this.endLocalTurn(moved);
	}

	// --- external changes --------------------------------------------------

	/**
	 * Re-read a conversation file after an Obsidian create/modify event.
	 *
	 * Callers only need the filename-derived session id; parsing, self-write
	 * suppression, idempotence and conflict detection all stay below the UI.
	 */
	async upsertExternalSession(sessionId: string): Promise<ExternalSessionChangeResult> {
		return this.applyExternalRead(await this.store.readSessionFile(sessionId));
	}

	/** Apply an Obsidian delete event without performing a second disk delete. */
	async deleteExternalSession(sessionId: string): Promise<ExternalSessionChangeResult> {
		const local = this.sessions.get(sessionId);
		if (!local) {
			this.clearSyncTracking(sessionId);
			return { kind: "unchanged", sessionId };
		}
		const baseFingerprint = this.syncedFingerprints.get(sessionId);
		if (this.activeLocalTurns.has(sessionId) || (baseFingerprint !== undefined && fingerprintSession(local) !== baseFingerprint)) {
			return { kind: "conflict", sessionId, operation: "delete", local, external: null };
		}

		const activeSessionDeleted = this.activeId === sessionId;
		this.sessions.delete(sessionId);
		this.clearSyncTracking(sessionId);
		if (activeSessionDeleted) this.activeId = this.fallbackActiveId();
		return { kind: "deleted", sessionId, activeSessionDeleted };
	}

	/**
	 * Apply an Obsidian rename event. Both ids come from paths; JSON ids are not
	 * trusted. If a file is renamed over another known session, preserve both in
	 * memory and report a conflict rather than silently discarding either side.
	 */
	async renameExternalSession(previousSessionId: string, sessionId: string): Promise<ExternalSessionChangeResult> {
		if (previousSessionId === sessionId) return this.upsertExternalSession(sessionId);
		const read = await this.store.readSessionFile(sessionId);
		if (read.kind !== "loaded") return this.externalReadFailure(read);

		const existing = this.sessions.get(sessionId);
		const previous = this.sessions.get(previousSessionId);
		if (existing && existing !== previous && fingerprintSession(existing) !== read.fingerprint) {
			return { kind: "conflict", sessionId, previousSessionId, operation: "rename", local: existing, external: read.session };
		}
		const previousBase = this.syncedFingerprints.get(previousSessionId);
		if (previous && (this.activeLocalTurns.has(previousSessionId) || (previousBase !== undefined && fingerprintSession(previous) !== previousBase))) {
			return {
				kind: "conflict",
				sessionId: previousSessionId,
				previousSessionId,
				operation: "rename",
				local: previous,
				external: read.session,
			};
		}

		const activeSessionRenamed = this.activeId === previousSessionId;
		this.sessions.delete(previousSessionId);
		this.clearSyncTracking(previousSessionId);
		this.sessions.set(sessionId, read.session);
		this.syncedFingerprints.set(sessionId, read.fingerprint);
		this.consumeSelfWrite(sessionId, read.fingerprint);
		if (activeSessionRenamed) this.activeId = sessionId;

		return {
			kind: "renamed",
			sessionId,
			previousSessionId,
			session: read.session,
			activeSessionRenamed,
		};
	}

	/** Explicit names make wiring create and modify events self-documenting. */
	async createExternalSession(sessionId: string): Promise<ExternalSessionChangeResult> {
		return this.upsertExternalSession(sessionId);
	}

	async modifyExternalSession(sessionId: string): Promise<ExternalSessionChangeResult> {
		return this.upsertExternalSession(sessionId);
	}

	/** Preserve both sides of a conflict reported by an external Vault event. */
	async preserveExternalConflict(
		conflict: Extract<ExternalSessionChangeResult, { kind: "conflict" }>,
	): Promise<void> {
		const previous = conflict.previousSessionId ? this.sessions.get(conflict.previousSessionId) : null;
		const previousIsConflictLocal = previous === conflict.local;
		const previousWasActive = Boolean(previous && this.activeId === previous.id);
		const previousBase = previous ? this.syncedFingerprints.get(previous.id) : undefined;
		const previousDirty = Boolean(previous && (
			this.activeLocalTurns.has(previous.id) ||
			(previousBase !== undefined && fingerprintSession(previous) !== previousBase)
		));
		await this.preserveWriteConflict(
			conflict.local,
			conflict.external,
			conflict.external ? fingerprintSession(conflict.external) : null,
			conflict.operation === "delete"
				? t("session.deletedElsewhere")
				: conflict.operation === "rename"
					? t("session.renamedElsewhere")
					: t("session.updatedElsewhere"),
			conflict.external?.id ?? conflict.sessionId,
		);

		if (!previous || previousIsConflictLocal) return;
		if (previousDirty) {
			await this.preserveWriteConflict(previous, null, null, t("session.unsyncedBeforeRename"));
			return;
		}
		this.sessions.delete(previous.id);
		this.clearSyncTracking(previous.id);
		if (previousWasActive) this.activeId = conflict.external?.id ?? this.fallbackActiveId();
	}

	private applyExternalRead(read: SessionFileReadResult): ExternalSessionChangeResult {
		if (read.kind !== "loaded") return this.externalReadFailure(read);

		const { sessionId, session, fingerprint } = read;
		if (this.consumeSelfWrite(sessionId, fingerprint)) {
			this.syncedFingerprints.set(sessionId, fingerprint);
			return { kind: "self-write", sessionId };
		}

		const local = this.sessions.get(sessionId);
		if (!local) {
			this.sessions.set(sessionId, session);
			this.syncedFingerprints.set(sessionId, fingerprint);
			return { kind: "created", sessionId, session };
		}

		const localFingerprint = fingerprintSession(local);
		if (localFingerprint === fingerprint) {
			this.syncedFingerprints.set(sessionId, fingerprint);
			return { kind: "unchanged", sessionId };
		}

		const baseFingerprint = this.syncedFingerprints.get(sessionId);
		const turnActive = this.activeLocalTurns.has(sessionId);
		const relation = messageSequenceRelation(local.messages, session.messages);

		// Disk holds strictly fewer messages than we do, so taking it could only
		// lose some. Checked before anything else, including whether we have local
		// changes: since schema 6 a conversation arrives as several files, and a
		// half-delivered one is legitimately shorter than what we hold. Replacing
		// memory with it would drop the rest — and the next save would then delete
		// the shards that carried them, turning a slow sync into real loss.
		//
		// Deliberately not extended to `identical`. Same messages with different
		// metadata is the other device renaming or archiving a conversation, and
		// accepting that while we hold no local changes is the behaviour D-011
		// settled on.
		if (relation === "local-ahead") {
			this.syncedFingerprints.set(sessionId, fingerprint);
			return { kind: "unchanged", sessionId };
		}

		if (turnActive || (baseFingerprint !== undefined && localFingerprint !== baseFingerprint)) {
			// Same transcript, and we have unsaved metadata of our own. Keep it:
			// preserving a whole conversation over a rename is the pathology D-011
			// exists to stop, and last-writer-wins here means the local writer.
			if (relation === "identical") {
				this.syncedFingerprints.set(sessionId, fingerprint);
				return { kind: "unchanged", sessionId };
			}
			// A real fork, or a turn streaming into `local` whose object identity a
			// fast-forward would orphan: preserve both sides rather than choose.
			if (relation === "diverged" || turnActive) {
				return { kind: "conflict", sessionId, operation: "update", local, external: session };
			}
		}

		this.sessions.set(sessionId, session);
		this.syncedFingerprints.set(sessionId, fingerprint);
		return { kind: "updated", sessionId, session };
	}

	private externalReadFailure(read: Exclude<SessionFileReadResult, { kind: "loaded" }>): ExternalSessionChangeResult {
		if (read.kind === "missing") return { kind: "unchanged", sessionId: read.sessionId };
		return { kind: "malformed", sessionId: read.sessionId, reason: read.reason };
	}

	/** Open sessions, newest first, as a depth-first branch tree. */
	openSessions(): SessionTreeNode[] {
		return this.buildTree((session) => !session.closed);
	}

	/** Closed sessions, newest first. History, not a graveyard. */
	closedSessions(): ConversationSession[] {
		return [...this.sessions.values()]
			.filter((session) => session.closed)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	}

	/**
	 * Depth-first ordering by branch ancestry. A branch whose parent is closed
	 * or missing renders at the top level rather than vanishing.
	 */
	private buildTree(include: (session: ConversationSession) => boolean): SessionTreeNode[] {
		const visible = [...this.sessions.values()].filter(include);
		const byId = new Map(visible.map((session) => [session.id, session]));
		const children = new Map<string, ConversationSession[]>();
		const roots: ConversationSession[] = [];

		for (const session of visible) {
			const parentId = session.branchedFrom?.sessionId;
			if (parentId && byId.has(parentId)) {
				const list = children.get(parentId) ?? [];
				list.push(session);
				children.set(parentId, list);
			} else {
				roots.push(session);
			}
		}

		const newestFirst = (a: ConversationSession, b: ConversationSession) =>
			b.updatedAt.localeCompare(a.updatedAt);
		roots.sort(newestFirst);

		const nodes: SessionTreeNode[] = [];
		const walk = (session: ConversationSession, depth: number): void => {
			nodes.push({ session, depth });
			const kids = (children.get(session.id) ?? []).sort(newestFirst);
			for (const child of kids) walk(child, depth + 1);
		};
		for (const root of roots) walk(root, 0);
		return nodes;
	}

	// --- mutation ----------------------------------------------------------

	async createSession(): Promise<ConversationSession> {
		const timestamp = nowIso();
		const session: ConversationSession = {
			schemaVersion: CONVERSATION_SCHEMA_VERSION,
			id: createSessionId(),
			title: UNTITLED,
			titleIsManual: false,
			createdAt: timestamp,
			updatedAt: timestamp,
			closed: false,
			messages: [],
			relatedFiles: [],
			preferences: {},
		};
		this.sessions.set(session.id, session);
		this.activeId = session.id;
		await this.saveAndTrack(session);
		return session;
	}

	/**
	 * Put a conversation back to an earlier local revision.
	 *
	 * The restored transcript keeps the id it is replacing, so the writer's
	 * place in the list, their per-conversation routing, and any link into it
	 * all keep working. The current content is not discarded: the ordinary
	 * pre-write snapshot runs first, so the state being replaced is itself
	 * recoverable, and restoring the wrong revision is undoable by restoring
	 * again.
	 *
	 * Refuses a revision belonging to a different conversation. A transcript is
	 * only interchangeable with its own history.
	 */
	async restoreSession(sessionId: string, revision: ConversationSession): Promise<ConversationSession | null> {
		const current = this.sessions.get(sessionId);
		if (!current || revision.id !== sessionId) return null;
		const restored: ConversationSession = {
			...structuredClone(revision),
			id: sessionId,
			updatedAt: nowIso(),
		};
		// Replace in place so anything already holding the object — an open view,
		// a pending render — is looking at the restored transcript.
		Object.assign(current, restored);
		for (const key of Object.keys(current) as Array<keyof ConversationSession>) {
			if (!(key in restored)) delete current[key];
		}
		await this.saveAndTrack(current);
		return current;
	}

	/** Ensure there is something to type into. */
	async ensureActive(): Promise<ConversationSession> {
		const active = this.getActive();
		if (active && !active.closed) return active;
		return this.createSession();
	}

	/**
	 * Open a conversation.
	 *
	 * Opening an archived one does **not** un-archive it. Reading something you
	 * filed away is not the same as taking it back out, and silently changing
	 * one flag because you looked at it is how a list stops meaning anything.
	 */
	async setActive(sessionId: string): Promise<void> {
		if (!this.sessions.has(sessionId)) return;
		this.activeId = sessionId;
	}

	/**
	 * Archive, or take back out. The transcript stays on disk either way.
	 *
	 * This is the `closed` flag the schema has always carried, given the name it
	 * always meant: archiving hides a conversation from the list and nothing
	 * else. Deleting is a separate, irreversible act.
	 */
	async setArchived(sessionId: string, archived: boolean): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session || session.closed === archived) return;
		session.closed = archived;
		await this.saveAndTrack(session);

		// Archiving the conversation you are in leaves you in it — it is still
		// open in front of you, and yanking you elsewhere would be a surprise.
	}

	/** Archived conversations, newest first. */
	archivedSessions(): ConversationSession[] {
		return this.closedSessions();
	}

	/** Permanently delete every archived conversation, with bounded vault I/O. */
	async deleteArchivedSessions(): Promise<number> {
		const archived = this.archivedSessions();
		await mapWithConcurrency(archived, async (session) => {
			await this.store.deleteSession(session.id);
		});
		for (const session of archived) {
			this.sessions.delete(session.id);
			this.clearSyncTracking(session.id);
		}
		if (this.activeId && !this.sessions.has(this.activeId)) {
			this.activeId = this.openSessions()[0]?.session.id ?? null;
		}
		return archived.length;
	}

	/** Irreversible. Only ever called from an explicitly confirmed action. */
	async deleteSession(sessionId: string): Promise<void> {
		this.sessions.delete(sessionId);
		await this.store.deleteSession(sessionId);
		this.clearSyncTracking(sessionId);
		if (this.activeId === sessionId) {
			this.activeId = this.openSessions()[0]?.session.id ?? null;
		}
	}

	/**
	 * Fork a session after a completed answer. The new session carries the
	 * transcript up to and including that message, plus its ancestry.
	 */
	async branchFrom(sessionId: string, messageIndex: number): Promise<ConversationSession | null> {
		const parent = this.sessions.get(sessionId);
		if (!parent) return null;
		if (messageIndex < 0 || messageIndex >= parent.messages.length) return null;

		const timestamp = nowIso();
		const branch: ConversationSession = {
			schemaVersion: CONVERSATION_SCHEMA_VERSION,
			id: createSessionId(),
			title: parent.title === UNTITLED ? UNTITLED : truncateChars(parent.title, 20),
			titleIsManual: false,
			createdAt: timestamp,
			updatedAt: timestamp,
			closed: false,
			messages: parent.messages.slice(0, messageIndex + 1).map((message) => ({ ...message })),
			relatedFiles: [...parent.relatedFiles],
			preferences: {},
			branchedFrom: { sessionId, messageIndex },
		};
		if (parent.selection) branch.selection = { ...parent.selection };

		this.sessions.set(branch.id, branch);
		this.activeId = branch.id;
		await this.saveAndTrack(branch);
		return branch;
	}

	async appendMessage(sessionId: string, message: ConversationMessage): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		session.messages.push(message);
		if (message.selection) {
			this.rememberFile(session, message.selection.filePath);
		}
		if (!session.titleIsManual && session.title === UNTITLED && message.role === "user") {
			session.title = deriveTitle(message.text, message.selection);
		}
		await this.persist(session);
	}

	/** Persist an in-place edit to the last message, as streaming completes. */
	async persist(sessionOrId: ConversationSession | string): Promise<void> {
		const session = typeof sessionOrId === "string" ? this.sessions.get(sessionOrId) : sessionOrId;
		if (!session) return;
		session.updatedAt = nowIso();
		await this.saveAndTrack(session);
	}

	async setTitle(sessionId: string, title: string, manual: boolean): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		// A title the writer typed is never overwritten by a derived one.
		if (session.titleIsManual && !manual) return;
		session.title = title.trim() || UNTITLED;
		session.titleIsManual = manual;
		await this.persist(session);
	}

	async setSelection(sessionId: string, attachment: SelectionAttachment | null): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) return;
		if (attachment) {
			session.selection = attachment;
			this.rememberFile(session, attachment.filePath);
		} else {
			delete session.selection;
		}
		// Deliberately not persisted. Until the writer sends, the attachment is
		// Composer draft state; writing it rewrote the whole synced conversation
		// on every caret gesture, which is what put two open devices in conflict
		// without either of them editing anything. The sent turn carries its own
		// selection snapshot, so history keeps everything it had.
	}

	private rememberFile(session: ConversationSession, filePath: string): void {
		session.relatedFiles = [filePath, ...session.relatedFiles.filter((path) => path !== filePath)].slice(0, 20);
	}

	private async saveAndTrack(session: ConversationSession): Promise<void> {
		const base = this.syncedFingerprints.get(session.id);
		if (base !== undefined) {
			const disk = await this.store.readSessionFile(session.id);
			const pending = disk.kind === "loaded" && this.hasSelfWrite(session.id, disk.fingerprint);
			if (disk.kind === "loaded" && disk.fingerprint !== base && !pending) {
				// Overwriting a revision that is behind us, or says the same thing,
				// loses nothing. Only a revision holding messages we do not have is
				// a conflict worth preserving both sides of.
				const relation = messageSequenceRelation(session.messages, disk.session.messages);
				if (relation === "external-ahead" || relation === "diverged") {
					await this.preserveWriteConflict(session, disk.session, disk.fingerprint, t("session.updatedElsewhere"));
					return;
				}
			}
			if (disk.kind === "missing") {
				await this.preserveWriteConflict(session, null, null, t("session.fileDeletedElsewhere"));
				return;
			}
			if (disk.kind === "malformed") {
				await this.preserveWriteConflict(session, null, null, t("session.syncUnreadable"));
				return;
			}
		}
		const receipt = await this.store.saveSessionWithReceipt(session);
		// ProjectStore stamps updatedAt while serializing. Reflect the exact saved
		// revision in memory so a later external change is compared to the right base.
		Object.assign(session, receipt.session);
		this.syncedFingerprints.set(session.id, receipt.fingerprint);
		this.rememberSelfWrite(session.id, receipt.fingerprint);
	}

	private async preserveWriteConflict(
		local: ConversationSession,
		external: ConversationSession | null,
		externalFingerprint: string | null,
		reason = t("session.updatedElsewhere"),
		externalSessionId = local.id,
	): Promise<void> {
		const originalSessionId = local.id;
		const timestamp = nowIso();
		const copy: ConversationSession = {
			...structuredClone(local),
			id: createSessionId(),
			title: truncateChars(t("session.conflictCopyTitle", { title: local.title }), 36),
			titleIsManual: true,
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		delete copy.branchedFrom;
		const receipt = await this.store.saveSessionWithReceipt(copy);
		// Keep the caller's object identity alive. A send already in progress
		// holds this object and must append its answer to the preserved copy.
		Object.assign(local, receipt.session);
		delete local.branchedFrom;
		this.sessions.set(copy.id, local);
		this.syncedFingerprints.set(copy.id, receipt.fingerprint);
		this.rememberSelfWrite(copy.id, receipt.fingerprint);
		if (this.activeLocalTurns.delete(originalSessionId)) {
			this.activeLocalTurns.add(copy.id);
			this.remappedTurns.set(originalSessionId, copy.id);
		}
		if (this.activeId === originalSessionId) this.activeId = copy.id;

		if (external && externalFingerprint) {
			if (externalSessionId !== originalSessionId) {
				this.sessions.delete(originalSessionId);
				this.clearSyncTracking(originalSessionId);
			}
			this.sessions.set(externalSessionId, external);
			this.syncedFingerprints.set(externalSessionId, externalFingerprint);
			this.pendingSelfWrites.delete(externalSessionId);
		} else if (!external) {
			this.sessions.delete(originalSessionId);
			this.clearSyncTracking(originalSessionId);
		}

		this.onWriteConflict({
			originalSessionId,
			preservedSession: local,
			external,
			reason: t("session.conflictPreserved", { reason, title: copy.title }),
		});
	}

	private rememberSelfWrite(sessionId: string, fingerprint: string): void {
		const recent = (this.pendingSelfWrites.get(sessionId) ?? []).filter((value) => value !== fingerprint);
		recent.push(fingerprint);
		this.pendingSelfWrites.set(sessionId, recent.slice(-MAX_TRACKED_SELF_WRITES));
	}

	/** Whether this exact revision is one we wrote, without consuming it. */
	private hasSelfWrite(sessionId: string, fingerprint: string): boolean {
		return (this.pendingSelfWrites.get(sessionId) ?? []).includes(fingerprint);
	}

	private consumeSelfWrite(sessionId: string, fingerprint: string): boolean {
		const recent = this.pendingSelfWrites.get(sessionId);
		if (!recent) return false;
		const at = recent.indexOf(fingerprint);
		if (at < 0) return false;
		// Anything older than the echo we just matched can no longer be current.
		this.pendingSelfWrites.set(sessionId, recent.slice(at + 1));
		return true;
	}

	private clearSyncTracking(sessionId: string): void {
		this.syncedFingerprints.delete(sessionId);
		this.pendingSelfWrites.delete(sessionId);
	}

	private fallbackActiveId(): string | null {
		return this.openSessions()[0]?.session.id ?? null;
	}
}

/** Same canonical representation ProjectStore writes. */
/**
 * How the in-memory transcript relates to the one that arrived on disk.
 *
 * A conversation is appended to, so most divergence between two devices is one
 * side being behind rather than a real fork. Comparing only fingerprints could
 * not tell those apart, and every stale sync echo became a preserved copy of a
 * multi-megabyte file. This compares the complete ordered messages, because an
 * edit to an earlier message is a genuine fork that ids alone would hide.
 */
export type MessageSequenceRelation = "identical" | "local-ahead" | "external-ahead" | "diverged";

export function messageSequenceRelation(
	local: readonly ConversationMessage[],
	external: readonly ConversationMessage[],
): MessageSequenceRelation {
	const shared = Math.min(local.length, external.length);
	for (let at = 0; at < shared; at += 1) {
		if (canonicalJson(local[at]) !== canonicalJson(external[at])) return "diverged";
	}
	if (local.length === external.length) return "identical";
	return local.length > external.length ? "local-ahead" : "external-ahead";
}

/** Key-order-independent structural text, so equal messages compare equal. */
function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, item]) => item !== undefined)
		.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
	return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

function fingerprintSession(session: ConversationSession): string {
	return fingerprintSessionContents(serializeSession(session));
}

/**
 * A title derived from the writer's own words.
 *
 * Deliberately boring: it uses the question, or the start of the attached
 * passage, and never invents a topic. A generated title that is wrong is worse
 * than a plain one.
 */
export function deriveTitle(question: string, selection?: SelectionAttachment): string {
	const cleaned = question.replace(/\s+/g, " ").trim();
	if (cleaned.length > 0) {
		const firstClause = cleaned.split(/[。！？!?\n]/)[0] || cleaned;
		return truncateChars(firstClause, 18);
	}
	if (selection) {
		const snippet = selection.text.replace(/\s+/g, " ").trim();
		if (snippet.length > 0) return truncateChars(snippet, 18);
		return selection.fileName;
	}
	return UNTITLED;
}
