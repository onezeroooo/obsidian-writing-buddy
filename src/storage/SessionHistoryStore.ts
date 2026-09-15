/**
 * A local safety net under every conversation write.
 *
 * The gap this fills is not a bug in the conflict machinery — that compares
 * complete message sequences and preserves both sides of a genuine fork
 * (D-011, PC-015). It is that the plugin can only defend content it has
 * *seen*. Obsidian Sync replaces a conversation file wholesale, and if it does
 * so before this plugin has read that file — the ordinary startup race, since
 * sync begins at roughly the moment plugins load — then the replaced content
 * never entered memory, no comparison happens, and no copy is preserved.
 *
 * Official version history does not cover the gap either: it is built for
 * notes, and a conversation is a `.json`, which its viewer cannot even
 * preview. So a conversation replaced that way is simply gone.
 *
 * This keeps a small rolling set of previous revisions **outside the synced
 * root** (see `CACHE_DIR`), written just before each overwrite. It is
 * deliberately dumb: no merging, no conflict opinion, no recovery UI. It only
 * guarantees that the bytes that were on disk a moment ago still exist
 * somewhere afterwards.
 *
 * Never on the critical path: every failure here is swallowed, because losing
 * a snapshot is a smaller harm than failing the write it was protecting.
 */

import { SESSION_HISTORY_DIR, sessionHistoryDir, type VaultFs } from "./paths";

/**
 * Revisions kept per conversation.
 *
 * Enough to cover a bad sync that is noticed a few turns later, small enough
 * that the folder stays trivial next to the conversations themselves.
 */
export const SESSION_HISTORY_LIMIT = 12;

export interface SessionHistoryEntry {
	path: string;
	/** Sortable, filename-safe, and readable enough to pick from by eye. */
	stamp: string;
}

export class SessionHistoryStore {
	constructor(
		private readonly fs: VaultFs,
		private readonly limit: number = SESSION_HISTORY_LIMIT,
		private readonly now: () => Date = () => new Date(),
	) {}

	/**
	 * Keep one revision of a conversation, before it is replaced.
	 *
	 * Takes the caller's *previous* content rather than reading a path, because
	 * since schema 6 a conversation is a manifest plus shards and no single file
	 * holds the transcript. The caller assembles it and hands over a complete,
	 * self-contained conversation — which is also what a restore needs, so a
	 * snapshot can be read back without the shards it came from still existing.
	 */
	async snapshot(sessionId: string, contents: string | null): Promise<string | null> {
		try {
			if (contents === null || !contents.trim()) return null;
			const directory = sessionHistoryDir(sessionId);
			await this.ensureDirectory(directory);
			const target = `${directory}/${this.stamp()}.json`;
			// A same-millisecond second write would collide; one snapshot per
			// instant is plenty, so keep the earlier one and move on.
			if (await this.fs.exists(target)) return null;
			await this.fs.write(target, contents);
			await this.trim(directory);
			return target;
		} catch {
			return null;
		}
	}

	/** Newest first, so a recovery reads top-down. */
	async list(sessionId: string): Promise<SessionHistoryEntry[]> {
		const directory = sessionHistoryDir(sessionId);
		try {
			if (!(await this.fs.exists(directory))) return [];
			const listed = await this.fs.list(directory);
			return listed.files
				.filter((path) => path.endsWith(".json"))
				.map((path) => ({ path, stamp: path.split("/").pop()?.replace(/\.json$/u, "") ?? "" }))
				.sort((left, right) => right.stamp.localeCompare(left.stamp));
		} catch {
			return [];
		}
	}

	async read(path: string): Promise<string | null> {
		try {
			return await this.fs.read(path);
		} catch {
			return null;
		}
	}

	/** Forget a conversation the writer deleted on purpose. */
	async forget(sessionId: string): Promise<void> {
		const directory = sessionHistoryDir(sessionId);
		try {
			if (!(await this.fs.exists(directory))) return;
			for (const file of (await this.fs.list(directory)).files) {
				await this.fs.remove(file).catch(() => undefined);
			}
			await this.fs.remove(directory).catch(() => undefined);
		} catch {
			// A leftover folder is harmless; it is outside the synced root.
		}
	}

	private async trim(directory: string): Promise<void> {
		try {
			const listed = await this.fs.list(directory);
			const files = listed.files.filter((path) => path.endsWith(".json")).sort();
			for (const path of files.slice(0, Math.max(0, files.length - this.limit))) {
				await this.fs.remove(path).catch(() => undefined);
			}
		} catch {
			// Trimming is housekeeping. A folder that keeps one extra revision is
			// not a problem worth reporting.
		}
	}

	private async ensureDirectory(directory: string): Promise<void> {
		for (const path of [SESSION_HISTORY_DIR, directory]) {
			if (await this.fs.exists(path)) continue;
			try {
				await this.fs.mkdir(path);
			} catch {
				if (!(await this.fs.exists(path))) throw new Error(`Cannot create ${path}`);
			}
		}
	}

	/** `20260906-014233-102`: sorts lexicographically in real time order. */
	private stamp(): string {
		const at = this.now();
		const pad = (value: number, width = 2): string => String(value).padStart(width, "0");
		return [
			`${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`,
			`${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}`,
			pad(at.getMilliseconds(), 3),
		].join("-");
	}
}
