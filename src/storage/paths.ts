/**
 * Where WritingBuddy keeps project data.
 *
 * Everything under this root lives *inside the vault*, so a conversation
 * belongs to the manuscript and travels with it through whatever sync the
 * writer already uses. Nothing here is machine-specific, and nothing here may
 * ever contain a credential — see `DeviceStore` for that.
 *
 * The root is `WritingBuddy/`, deliberately **not** dot-prefixed:
 *
 *   - A dot-folder is hidden content as far as Obsidian is concerned. Syncing
 *     it requires Self-hosted LiveSync's Hidden File Sync, which is opt-in,
 *     slower, and conflict-prone. Ordinary folders sync with no special setup.
 *   - Hidden paths are also second-class to the vault adapter and are excluded
 *     from Obsidian's file index, which removes the ability to cross-check an
 *     enumeration against `vault.getFiles()`.
 *
 * It is a plain folder name, sitting among the writer's own. It carried a
 * leading underscore for a while to sort it to the top and mark it as
 * machinery, which is a convention from tooling rather than from manuscripts —
 * and this folder is the writer's data, not the plugin's scratch space.
 *
 * Project data must never live inside `.obsidian/` either: that folder is
 * app configuration, is hidden, and is frequently excluded from sync.
 */

export const PROJECT_ROOT = "WritingBuddy";

export const PROJECT_FILE = `${PROJECT_ROOT}/project.json`;
/** Durable checkpoint for retryable migration from a pre-WritingBuddy root. */
export const LEGACY_ROOT_MIGRATION_FILE = `${PROJECT_ROOT}/legacy-root-migration.json`;
export const CONVERSATIONS_DIR = `${PROJECT_ROOT}/conversations`;
export const EDITS_DIR = `${PROJECT_ROOT}/edits`;
export const MEMORY_DIR = `${PROJECT_ROOT}/memory`;
/**
 * Durable, plugin-owned derived data. Never treated as manuscript context.
 *
 * Deliberately hidden, and the one place in this file where that is right.
 * Obsidian Sync uploads a whole file on every change and keeps each revision
 * as a complete copy against the writer's paid quota; a dot-prefixed folder is
 * never uploaded at all, with no setting to change that. Measured on the
 * long-novel test vault, a few days of Full analysis left 320 memo files and
 * 4.5 MB here, with nothing that ever removed one.
 *
 * What this costs is resuming a Full run on a *different* synced device. That
 * is rare, its failure mode is recomputation rather than loss, and it is not
 * worth a folder that grows without bound inside a quota. Local resume — the
 * common case, and the one `Continue` exists for — is unaffected.
 *
 * Conversations do not move here. They are the writer's own history, they are
 * meant to travel between devices, and PC-014 puts them somewhere visible.
 */
export const CACHE_DIR = ".writing-buddy-cache";
/** Content-addressed intermediate results for resumable Full analysis. */
export const FULL_CORPUS_CACHE_DIR = `${CACHE_DIR}/full-corpus`;
/**
 * Previous revisions of each conversation, kept before it is overwritten.
 *
 * Hidden for the same reason the rest of this root is, and additionally
 * because it must not itself become something sync can replace: it exists to
 * survive a sync that replaced the real file.
 */
export const SESSION_HISTORY_DIR = `${CACHE_DIR}/conversation-history`;
/** Where the cache lived while it was still inside the synced project root. */
export const LEGACY_CACHE_DIR = `${PROJECT_ROOT}/cache`;
export const LEGACY_FULL_CORPUS_CACHE_DIR = `${LEGACY_CACHE_DIR}/full-corpus`;
/** Parent for optional writer-owned project instructions. No file is seeded. */
export const INSTRUCTIONS_DIR = `${PROJECT_ROOT}/instructions`;
export const SKILLS_DIR = `${PROJECT_ROOT}/skills`;
/** Writer-authored skills that do not derive from a packaged skill. */
export const CUSTOM_SKILLS_DIR = `${SKILLS_DIR}/custom`;
/** Writer-owned customizations of immutable packaged skills. */
export const SKILL_OVERRIDES_DIR = `${SKILLS_DIR}/overrides`;
/** Skill bookkeeping. Active skill Markdown never lives in this directory. */
export const SKILL_STATE_DIR = `${SKILLS_DIR}/state`;
/** Records how each legacy flat skill file was classified, without moving it. */
export const SKILL_MIGRATION_FILE = `${SKILL_STATE_DIR}/migration.json`;
/** Independent receipt ledger written only by the explicit Reset operation. */
export const SKILL_RESET_STATE_FILE = `${SKILL_STATE_DIR}/resets.json`;

/**
 * Roots this plugin has used before, newest first.
 *
 * Read once each, for migration, then left alone — never written to, never
 * deleted. A writer who opens an old vault gets their conversations back; the
 * old folder stays where it is until they remove it themselves, because a
 * plugin quietly deleting a folder full of someone's work is not a risk worth
 * taking to save them one drag to the bin.
 */
export const LEGACY_PROJECT_ROOTS = ["_WritingBuddy", ".writing-buddy"] as const;

/** The pre-1.0 hidden root. Kept as a name for the migration notice. */
export const LEGACY_PROJECT_ROOT = ".writing-buddy";

/**
 * Every directory the plugin expects to exist under the visible project root.
 *
 * The cache is not here. It lives outside this root now (see `CACHE_DIR`) and
 * creates itself on first use, so a vault that never runs a Full analysis
 * never grows the folder at all.
 */
export const PROJECT_DIRECTORIES = [
	PROJECT_ROOT,
	CONVERSATIONS_DIR,
	EDITS_DIR,
	MEMORY_DIR,
	INSTRUCTIONS_DIR,
	SKILLS_DIR,
	CUSTOM_SKILLS_DIR,
	SKILL_OVERRIDES_DIR,
	SKILL_STATE_DIR,
] as const;

/**
 * The manifest, and the filename every build has used for a conversation.
 *
 * Schema 6 keeps this path occupied on purpose: a build that predates it finds
 * a file it can refuse rather than an absence it would read as a deletion.
 */
export function conversationPath(sessionId: string): string {
	return `${CONVERSATIONS_DIR}/${sessionId}.json`;
}

/** The shard folder beside the manifest, holding the transcript itself. */
export function conversationShardDir(sessionId: string): string {
	return `${CONVERSATIONS_DIR}/${sessionId}`;
}

export function conversationShardPath(sessionId: string, name: string): string {
	return `${conversationShardDir(sessionId)}/${name}.json`;
}

/** One immutable JSON object per SHA-256 semantic-input address. */
export function fullCorpusMemoPath(key: string): string {
	return `${FULL_CORPUS_CACHE_DIR}/${key}.json`;
}

/** The same address under the pre-move synced location. Read-only. */
export function legacyFullCorpusMemoPath(key: string): string {
	return `${LEGACY_FULL_CORPUS_CACHE_DIR}/${key}.json`;
}

/** One folder of timestamped revisions per conversation. */
export function sessionHistoryDir(sessionId: string): string {
	return `${SESSION_HISTORY_DIR}/${sessionId}`;
}

/** The applied-edit log. Reviewable history, not an undo stack. */
export const EDIT_HISTORY_FILE = `${EDITS_DIR}/history.json`;

/**
 * A minimal filesystem, satisfied by Obsidian's vault adapter and by an
 * in-memory fake in the tests. Paths are always vault-relative and use `/`.
 */
export interface VaultFs {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	/** Optional byte-preserving operations used by legacy-root migration. */
	readBinary?(path: string): Promise<ArrayBuffer>;
	writeBinary?(path: string, data: ArrayBuffer): Promise<void>;
	mkdir(path: string): Promise<void>;
	list(path: string): Promise<{ files: string[]; folders: string[] }>;
	remove(path: string): Promise<void>;
	/**
	 * Optional file metadata, used only to evict the oldest cache entries.
	 *
	 * Optional because eviction degrades to an arbitrary but still bounded
	 * order without it, and because an in-memory fake has nothing useful to
	 * report. Nothing that affects correctness may depend on this.
	 */
	stat?(path: string): Promise<{ mtime: number; size: number } | null>;
}
