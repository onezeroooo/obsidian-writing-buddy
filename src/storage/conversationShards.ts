/**
 * Schema 6: a conversation as a small manifest plus append-only shards.
 *
 * Why the shape is this and not something simpler:
 *
 *   - **Obsidian Sync uploads whole files and keeps every revision.** A turn
 *     used to rewrite the entire transcript, so a 1.8M-character conversation
 *     paid 1.8M characters of upload — and one stored revision — for 165 bytes
 *     of new content. Sharding makes a turn cost roughly a turn. A shard that
 *     stops changing is uploaded once and never produces a second revision.
 *   - **The manifest keeps the old filename.** `conversations/<id>.json` still
 *     exists, so a build that predates schema 6 finds a file and refuses it as
 *     too new (D-019), rather than finding nothing and concluding the writer
 *     deleted the conversation — which would preserve its in-memory copy as a
 *     conflict copy and duplicate the transcript.
 *   - **The manifest does not list its shards.** It was tempting: a list makes
 *     "is this session complete?" answerable. But sync delivers files
 *     independently, so a listed-but-absent shard is a new state — neither
 *     present nor deleted — that every reader would have to handle. Reading
 *     whatever shards are on disk instead makes a half-delivered conversation
 *     simply *shorter*, and "the other side has fewer messages than we do" is a
 *     state D-011 already classifies correctly, as external-behind. The local
 *     transcript stands and nothing is preserved as a copy.
 *
 * Shards are written by content, not by position: the messages are grouped, and
 * only groups whose bytes actually changed are written. Appending a turn
 * therefore touches one shard, while an edit to an older message rewrites only
 * the shard holding it.
 */

import type { ConversationMessage, ConversationSession, SelectionAttachment } from "../types";
import { UNTITLED } from "../session/titles";
import {
	parseBranch,
	parseMessage,
	parseSelectionTable,
	selectionKey,
	storedSelection,
	type ParseResult,
} from "./conversationSchema";

export const SHARDED_CONVERSATION_SCHEMA_VERSION = 6;

/**
 * Messages per shard.
 *
 * The trade is upload volume against file count. A shard is rewritten on every
 * turn until it fills, so smaller shards mean fewer wasted bytes per upload and
 * more files; larger shards mean the opposite. Eight keeps a 600-message
 * conversation under a hundred files while capping the wasted rewrite at seven
 * turns' worth of text — both far below the whole-file rewrite this replaces.
 * How a sync service prices hundreds of small files is still unmeasured
 * (OW-105), so this stays one constant to change rather than a policy.
 */
export const SHARD_MESSAGE_LIMIT = 8;

/** `0001`, so a plain lexicographic sort is chronological. */
export function shardName(index: number): string {
	return String(index + 1).padStart(4, "0");
}

/** True for a shard filename this module writes, and nothing else. */
export function isShardFileName(name: string): boolean {
	return /^\d{4}\.json$/u.test(name);
}

export interface ConversationShard {
	name: string;
	contents: string;
}

export interface SerializedShardedSession {
	manifest: string;
	shards: ConversationShard[];
}

/**
 * The manifest: everything about a conversation except what it says.
 *
 * Rewritten on every turn, because `updatedAt` moves — but it is a few hundred
 * bytes, so a revision of it costs approximately nothing. Message content, the
 * part that grows without bound, is not here.
 */
export function serializeShardedSession(session: ConversationSession): SerializedShardedSession {
	const manifest: Record<string, unknown> = {
		schemaVersion: SHARDED_CONVERSATION_SCHEMA_VERSION,
		id: session.id,
		title: session.title,
		titleIsManual: session.titleIsManual,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		closed: session.closed,
		relatedFiles: session.relatedFiles,
	};
	if (session.branchedFrom) manifest.branchedFrom = session.branchedFrom;

	const shards: ConversationShard[] = [];
	for (let index = 0; index * SHARD_MESSAGE_LIMIT < session.messages.length; index += 1) {
		const slice = session.messages.slice(index * SHARD_MESSAGE_LIMIT, (index + 1) * SHARD_MESSAGE_LIMIT);
		shards.push({ name: shardName(index), contents: serializeShard(session.id, shardName(index), slice) });
	}

	return { manifest: `${JSON.stringify(manifest, null, "\t")}\n`, shards };
}

/**
 * One shard, self-contained.
 *
 * It carries the selections its own messages reference rather than pointing at
 * a table elsewhere. A little duplication across shards buys the property the
 * whole design rests on: a shard can be read, written and synced without any
 * other file, so nothing outside it can make it stale.
 */
function serializeShard(sessionId: string, name: string, messages: readonly ConversationMessage[]): string {
	const table = new Map<string, Record<string, unknown>>();
	const reference = (selection: SelectionAttachment): string => {
		const stored = storedSelection(selection);
		const key = selectionKey(stored);
		if (!table.has(key)) table.set(key, stored);
		return key;
	};

	const serializable: Record<string, unknown> = {
		schemaVersion: SHARDED_CONVERSATION_SCHEMA_VERSION,
		id: sessionId,
		shard: name,
		messages: messages.map((message) => {
			if (!message.selection) return message;
			const { selection, ...rest } = message;
			void selection;
			return { ...rest, selectionRef: reference(message.selection) };
		}),
	};
	if (table.size > 0) {
		serializable.selections = Object.fromEntries(
			[...table.entries()].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
		);
	}
	return `${JSON.stringify(serializable, null, "\t")}\n`;
}

export interface ParsedManifest {
	id: string;
	title: string;
	titleIsManual: boolean;
	createdAt: string;
	updatedAt: string;
	closed: boolean;
	relatedFiles: string[];
	branchedFrom?: ConversationSession["branchedFrom"];
}

/** Recognise a schema-6 manifest without committing to reading it. */
export function isShardedManifest(decoded: unknown): boolean {
	if (typeof decoded !== "object" || decoded === null) return false;
	const record = decoded as Record<string, unknown>;
	return record.schemaVersion === SHARDED_CONVERSATION_SCHEMA_VERSION;
}

export function parseManifest(decoded: unknown): ParseResult<ParsedManifest> {
	if (typeof decoded !== "object" || decoded === null) {
		return { ok: false, reason: "top level is not an object" };
	}
	const record = decoded as Record<string, unknown>;
	const version = typeof record.schemaVersion === "number" ? record.schemaVersion : 0;
	if (version > SHARDED_CONVERSATION_SCHEMA_VERSION) {
		return { ok: false, reason: `written by a newer version of WritingBuddy (schema ${version})` };
	}
	const id = typeof record.id === "string" && record.id.length > 0 ? record.id : null;
	if (!id) return { ok: false, reason: "missing session id" };

	const createdAt = typeof record.createdAt === "string" ? record.createdAt : new Date(0).toISOString();
	const manifest: ParsedManifest = {
		id,
		title: typeof record.title === "string" ? record.title : UNTITLED,
		titleIsManual: record.titleIsManual === true,
		createdAt,
		updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : createdAt,
		closed: record.closed === true,
		relatedFiles: Array.isArray(record.relatedFiles)
			? record.relatedFiles.filter((value): value is string => typeof value === "string")
			: [],
	};
	const branch = parseBranch(record.branchedFrom);
	if (branch) manifest.branchedFrom = branch;
	return { ok: true, value: manifest };
}

/**
 * Messages from one shard.
 *
 * An unreadable shard yields nothing rather than failing the conversation: the
 * loss is bounded to that shard's turns, and the writer keeps the rest. This
 * matches how an unresolvable selection reference already degrades.
 */
export function parseShard(raw: string): ConversationMessage[] {
	let decoded: unknown;
	try {
		decoded = JSON.parse(raw);
	} catch {
		return [];
	}
	if (typeof decoded !== "object" || decoded === null) return [];
	const record = decoded as Record<string, unknown>;
	if (!Array.isArray(record.messages)) return [];
	const selections = parseSelectionTable(record.selections);
	return record.messages
		.map((message) => parseMessage(message, selections))
		.filter((message): message is ConversationMessage => message !== null);
}

/** Manifest plus whatever shards were present, in shard-name order. */
export function assembleSession(
	manifest: ParsedManifest,
	shards: ReadonlyArray<{ name: string; contents: string }>,
): ConversationSession {
	const ordered = [...shards].sort((left, right) => left.name.localeCompare(right.name));
	return {
		schemaVersion: SHARDED_CONVERSATION_SCHEMA_VERSION,
		id: manifest.id,
		title: manifest.title,
		titleIsManual: manifest.titleIsManual,
		createdAt: manifest.createdAt,
		updatedAt: manifest.updatedAt,
		closed: manifest.closed,
		messages: ordered.flatMap((shard) => parseShard(shard.contents)),
		relatedFiles: manifest.relatedFiles,
		preferences: {},
		...(manifest.branchedFrom ? { branchedFrom: manifest.branchedFrom } : {}),
	};
}
