/**
 * Two kinds of state, in two places, for two reasons.
 *
 * **Portable knowledge** lives under `WritingBuddy/memory/novel/` as ordinary
 * Markdown, inside the visible project root, so the Markdown synchronization
 * every writer already has — Obsidian Sync, or anything else — carries it
 * between devices without a setting. One small manifest (`project.md`) holds
 * the book: manuscript scope, canon folders, bootstrap state, the engine that
 * wrote it. One bundle per source document (`sources/<docId>.md`) holds
 * Writing Buddy's record of that document — identity, path, story order,
 * point of view, the manuscript revision last processed — and, in fenced
 * blocks, every Recanta artifact that concerns it: its evidence revisions,
 * their extraction runs, the fact transitions they caused and their
 * lifecycle events. Recanta decides what those artifacts contain and how they
 * are named; Writing Buddy only packs and unpacks them, so a device that
 * receives a bundle rebuilds its memory without asking a model anything.
 * Corrections (`corrections/<id>.md`) are bundles of the same shape.
 *
 * These files are machine-managed: excluded from the manuscript, never canon,
 * never analyzed, validated before anything in them is believed. A bundle is
 * written whole beside its target and renamed over it where the platform
 * allows, and every block carries Recanta's checksum, so a torn write is
 * skipped rather than trusted and never replaces the last valid state.
 *
 * **Local index state** lives under `.writing-buddy-cache/novel/<book>/` — the
 * hidden cache root Obsidian Sync never uploads. The engine database (SQLite
 * bytes), the export cursor, which bundles were handled, the pending queue and
 * the last error are all here. Every byte of it is disposable: delete the
 * folder and the next start rebuilds it from the portable files.
 *
 * Both sides fail closed on a schema they do not know (PC-014, PC-020): a
 * newer file is left untouched and reported, never rewritten by an older
 * plugin, and a newer local state is discarded rather than guessed at.
 */

import type { PortableArtifact } from "recanta-dev";
import { CACHE_DIR, projectPaths, type VaultFs } from "../storage/paths";
import { type DocumentRecord, type DocumentRole, isDocumentId } from "./documentIdentity";
import { fnv1a } from "./novelKinds";

/**
 * Where novel knowledge lives under the project root. Getters, like every
 * other project path: the root can move while the vault is open (D-047).
 */
export const novelPaths = {
	get dir(): string {
		return `${projectPaths.memoryDir}/novel`;
	},
	get projectFile(): string {
		return `${this.dir}/project.md`;
	},
	get sourcesDir(): string {
		return `${this.dir}/sources`;
	},
	get correctionsDir(): string {
		return `${this.dir}/corrections`;
	},
	/** The pre-Markdown layout (JSON records and one file per Recanta row), migrated once and retired. */
	get legacyBookFile(): string {
		return `${this.dir}/book.json`;
	},
	get legacyDocumentsDir(): string {
		return `${this.dir}/documents`;
	},
	get legacyArtifactsDir(): string {
		return `${this.dir}/artifacts`;
	},
};
export const NOVEL_LOCAL_DIR = `${CACHE_DIR}/novel`;

export const NOVEL_PROJECT_SCHEMA_VERSION = 1;
export const NOVEL_SOURCE_SCHEMA_VERSION = 1;
export const NOVEL_LOCAL_STATE_SCHEMA_VERSION = 2;

/** The first frontmatter key of every managed file; a reader that does not find it treats the file as foreign. */
export const MANAGED_MARKER = "writing-buddy";
const MANAGED_NOTE = "> Managed by Writing Buddy. Do not edit: this file is manuscript knowledge that synchronizes between your devices. *Rebuild manuscript knowledge* regenerates it.";
const FENCE = "recanta-artifact";

export interface EngineIdentity {
	name: string;
	version: string;
	schemaVersion: number;
	artifactFormat: number;
}

export interface NovelBookRecord {
	schemaVersion: typeof NOVEL_PROJECT_SCHEMA_VERSION;
	format: "wb-novel-project-v1";
	bookId: string;
	/** Vault folder whose Markdown is the manuscript, `""` for the whole vault. */
	manuscriptRoot: string;
	/** Author-canon notes: files or folders, vault-relative. */
	canonPaths: string[];
	bootstrap: { status: "pending" | "complete"; completedAt: string | null };
	/** The engine that last wrote knowledge for this book; informational. */
	engine: EngineIdentity | null;
	createdAt: string;
	updatedAt: string;
}

export interface NovelChunkRecord {
	index: number;
	/** Content identity of this chunk alone. */
	revision: string;
	heading: string | null;
}

/**
 * One document's portable record: identity, the manuscript revision last
 * processed, its story order and point of view, and how it was chunked. The
 * knowledge itself travels beside it in the same bundle, as Recanta's artifacts.
 */
export interface NovelDocumentArtifact {
	schemaVersion: typeof NOVEL_SOURCE_SCHEMA_VERSION;
	format: "wb-novel-source-v1";
	docId: string;
	path: string;
	role: DocumentRole;
	status: "active" | "deleted";
	/** Content identity of the whole document this record describes. */
	revision: string | null;
	/** The revision counter handed to Recanta; strictly increasing per document. */
	version: number;
	ordinal: number | null;
	pov: string | null;
	chunks: NovelChunkRecord[];
	/** The engine whose artifacts the bundle carries; informational, the artifacts carry their own. */
	engine: EngineIdentity | null;
	/** The plugin that wrote this record, for diagnostics only. */
	writer: string;
	updatedAt: string;
}

/** A source bundle as read from disk: the record and every artifact block that parsed. */
export interface NovelSourceBundle {
	record: NovelDocumentArtifact;
	artifacts: PortableArtifact[];
	/** Fenced blocks that were unterminated or not JSON; a torn write leaves some. */
	tornBlocks: number;
}

export interface NovelCorrectionArtifact {
	schemaVersion: 1;
	format: "wb-novel-correction-v1";
	id: string;
	version: number;
	text: string;
	updatedAt: string;
}

export interface NovelCorrectionBundle {
	record: NovelCorrectionArtifact;
	artifacts: PortableArtifact[];
	tornBlocks: number;
}

/** What one device currently holds in its disposable index. */
export interface NovelLocalState {
	schemaVersion: typeof NOVEL_LOCAL_STATE_SCHEMA_VERSION;
	bookId: string;
	/** Per document: the version whose chunks are in the engine, and those chunk revisions. */
	loaded: Record<string, { version: number; chunkRevisions: string[] }>;
	/** Corrections currently in the engine, by id → version. */
	corrections: Record<string, number>;
	/** Recanta namespace version up to which this device has exported artifacts. */
	exportedVersion: number;
	/** Content hash of each bundle as last written or imported here; an unchanged bundle is not read again. */
	bundles: Record<string, string>;
	/** Artifact names reported divergent by the last rebuild; only a new one triggers another. */
	divergent: string[];
	/** Recanta engine/schema identity the database bytes were written by. */
	engine: { version: string; schemaVersion: number; indexVersion: string } | null;
	pending: NovelPendingItem[];
	lastError: string | null;
	updatedAt: string;
}

export type NovelPendingItem =
	| { kind: "document"; path: string }
	| { kind: "delete"; path: string }
	| { kind: "rename"; path: string; oldPath: string }
	| { kind: "artifact"; path: string; changed?: boolean }
	| { kind: "rebuild" };

/** Recanta database bytes live beside the state; both are disposable. */
export const NOVEL_INDEX_FILE = "index.sqlite";

export type ArtifactReadResult<T> =
	| { kind: "loaded"; value: T }
	| { kind: "missing" }
	| { kind: "newer"; schemaVersion: number }
	| { kind: "malformed"; reason: string };

export class NovelKnowledgeStore {
	constructor(private readonly fs: VaultFs, private readonly writer: string) {}

	// ---- portable: project ---------------------------------------------------

	async readBook(): Promise<ArtifactReadResult<NovelBookRecord>> {
		return this.readManaged(novelPaths.projectFile, "novel-project", NOVEL_PROJECT_SCHEMA_VERSION, (front) => parseBook(front));
	}

	async writeBook(record: NovelBookRecord): Promise<void> {
		await this.guardNewer(novelPaths.projectFile, NOVEL_PROJECT_SCHEMA_VERSION);
		await this.ensureDirs();
		const front: Record<string, unknown> = {
			[MANAGED_MARKER]: "novel-project", schemaVersion: NOVEL_PROJECT_SCHEMA_VERSION, format: "wb-novel-project-v1",
			bookId: record.bookId, manuscriptRoot: record.manuscriptRoot, canonPaths: record.canonPaths, bootstrap: record.bootstrap,
			engine: record.engine, createdAt: record.createdAt, updatedAt: record.updatedAt,
		};
		await this.writeAtomic(novelPaths.projectFile, renderManaged(front, `# Manuscript knowledge\n\n${MANAGED_NOTE}\n\nManuscript: \`${record.manuscriptRoot || "/"}\`. Canon: ${record.canonPaths.length ? record.canonPaths.map((path) => `\`${path}\``).join(", ") : "none"}.\n`));
	}

	// ---- portable: sources ---------------------------------------------------

	static sourcePath(docId: string): string {
		return `${novelPaths.sourcesDir}/${docId}.md`;
	}

	static isSourceBundlePath(path: string): boolean {
		return /^WritingBuddy\/memory\/novel\/sources\/d[0-9a-f]{16}\.md$/u.test(path.split("\\").join("/"));
	}

	static isCorrectionBundlePath(path: string): boolean {
		const normalized = path.split("\\").join("/");
		return normalized.startsWith(`${novelPaths.correctionsDir}/`) && normalized.endsWith(".md");
	}

	/** Every path this store manages; nothing here is manuscript, canon or context. */
	static isManagedPath(path: string): boolean {
		const normalized = path.split("\\").join("/");
		return normalized === novelPaths.dir || normalized.startsWith(`${novelPaths.dir}/`);
	}

	async listSourceIds(): Promise<string[]> {
		if (!(await this.fs.exists(novelPaths.sourcesDir))) return [];
		const listed = await this.fs.list(novelPaths.sourcesDir);
		return listed.files
			.map((file) => file.split("/").pop() ?? "")
			.filter((name) => name.endsWith(".md"))
			.map((name) => name.slice(0, -".md".length))
			.filter(isDocumentId)
			.sort();
	}

	async readSource(docId: string): Promise<ArtifactReadResult<NovelSourceBundle>> {
		const text = await this.readManagedText(NovelKnowledgeStore.sourcePath(docId));
		if (text.kind !== "loaded") return text;
		return NovelKnowledgeStore.parseSource(text.value, docId);
	}

	/**
	 * The file's text, or the staged copy a write left behind when it was
	 * interrupted between removing the old file and renaming the new one in.
	 */
	private async readManagedText(path: string): Promise<ArtifactReadResult<string>> {
		const staging = stagingPath(path);
		try {
			if (await this.fs.exists(path)) return { kind: "loaded", value: await this.fs.read(path) };
			if (this.fs.rename && (await this.fs.exists(staging))) {
				await this.fs.rename(staging, path);
				return { kind: "loaded", value: await this.fs.read(path) };
			}
			return { kind: "missing" };
		} catch (error) {
			return { kind: "malformed", reason: error instanceof Error ? error.message : String(error) };
		}
	}

	/** Parse a bundle's text: the record from its frontmatter, the artifacts from its fenced blocks. */
	static parseSource(text: string, docId: string): ArtifactReadResult<NovelSourceBundle> {
		const parsed = parseManaged(text, "novel-source", NOVEL_SOURCE_SCHEMA_VERSION);
		if (parsed.kind !== "loaded") return parsed;
		try {
			const record = parseDocumentRecord(parsed.value.front, docId);
			const { artifacts, tornBlocks } = parseBlocks(parsed.value.body);
			return { kind: "loaded", value: { record, artifacts, tornBlocks } };
		} catch (error) {
			return { kind: "malformed", reason: error instanceof Error ? error.message : String(error) };
		}
	}

	async writeSource(record: NovelDocumentArtifact, artifacts: readonly PortableArtifact[]): Promise<string> {
		const path = NovelKnowledgeStore.sourcePath(record.docId);
		await this.guardNewer(path, NOVEL_SOURCE_SCHEMA_VERSION);
		await this.ensureDirs();
		const stamped: NovelDocumentArtifact = { ...record, schemaVersion: NOVEL_SOURCE_SCHEMA_VERSION, format: "wb-novel-source-v1", writer: this.writer };
		const text = renderSource(stamped, artifacts);
		await this.writeAtomic(path, text);
		return contentHash(text);
	}

	async readAllSources(): Promise<{ bundles: NovelSourceBundle[]; skipped: Array<{ docId: string; reason: string }> }> {
		const bundles: NovelSourceBundle[] = [];
		const skipped: Array<{ docId: string; reason: string }> = [];
		for (const docId of await this.listSourceIds()) {
			const result = await this.readSource(docId);
			if (result.kind === "loaded") bundles.push(result.value);
			else if (result.kind === "newer") skipped.push({ docId, reason: `schema ${result.schemaVersion} is newer than this plugin` });
			else if (result.kind === "malformed") skipped.push({ docId, reason: result.reason });
		}
		return { bundles, skipped };
	}

	// ---- portable: corrections -----------------------------------------------

	static correctionPath(id: string): string {
		return `${novelPaths.correctionsDir}/${id}.md`;
	}

	async listCorrections(): Promise<NovelCorrectionBundle[]> {
		if (!(await this.fs.exists(novelPaths.correctionsDir))) return [];
		const listed = await this.fs.list(novelPaths.correctionsDir);
		const items: NovelCorrectionBundle[] = [];
		for (const file of listed.files) {
			if (!file.endsWith(".md")) continue;
			const result = await this.readCorrection(file.split("/").pop()!.slice(0, -".md".length));
			if (result.kind === "loaded") items.push(result.value);
		}
		return items.sort((a, b) => a.record.id.localeCompare(b.record.id));
	}

	async readCorrection(id: string): Promise<ArtifactReadResult<NovelCorrectionBundle>> {
		const read = await this.readManagedText(NovelKnowledgeStore.correctionPath(id));
		if (read.kind !== "loaded") return read;
		const parsed = parseManaged(read.value, "novel-correction", 1);
		if (parsed.kind !== "loaded") return parsed;
		const front = parsed.value.front;
		if (front.id !== id || typeof front.text !== "string") return { kind: "malformed", reason: "not a correction" };
		const version = typeof front.version === "number" && Number.isInteger(front.version) && front.version >= 1 ? front.version : 1;
		const record: NovelCorrectionArtifact = { schemaVersion: 1, format: "wb-novel-correction-v1", id, version, text: front.text, updatedAt: typeof front.updatedAt === "string" ? front.updatedAt : new Date(0).toISOString() };
		const { artifacts, tornBlocks } = parseBlocks(parsed.value.body);
		return { kind: "loaded", value: { record, artifacts, tornBlocks } };
	}

	async writeCorrection(record: NovelCorrectionArtifact, artifacts: readonly PortableArtifact[] = []): Promise<string> {
		if (!/^[a-z0-9][a-z0-9-]{0,63}$/u.test(record.id)) throw new Error("A correction id is lowercase letters, digits and dashes.");
		const path = NovelKnowledgeStore.correctionPath(record.id);
		await this.guardNewer(path, 1);
		await this.ensureDirs();
		const front: Record<string, unknown> = { [MANAGED_MARKER]: "novel-correction", schemaVersion: 1, format: "wb-novel-correction-v1", id: record.id, version: record.version, text: record.text, updatedAt: record.updatedAt };
		const text = renderManaged(front, `# Correction\n\n${MANAGED_NOTE}\n\n${record.text}\n${renderBlocks(artifacts)}`);
		await this.writeAtomic(path, text);
		return contentHash(text);
	}

	// ---- legacy JSON layout (migrated once) -----------------------------------

	/** True when the pre-Markdown layout is still present, in whole or in part. */
	async hasLegacyLayout(): Promise<boolean> {
		return (await this.fs.exists(novelPaths.legacyBookFile)) || (await this.fs.exists(novelPaths.legacyDocumentsDir)) || (await this.fs.exists(novelPaths.legacyArtifactsDir));
	}

	async readLegacyBook(): Promise<NovelBookRecord | null> {
		if (!(await this.fs.exists(novelPaths.legacyBookFile))) return null;
		try {
			const raw = JSON.parse(await this.fs.read(novelPaths.legacyBookFile)) as Record<string, unknown>;
			if (raw.format !== "wb-novel-book-v1" || typeof raw.bookId !== "string") return null;
			return parseBook({ ...raw, engine: null });
		} catch {
			return null;
		}
	}

	async readLegacyDocuments(): Promise<NovelDocumentArtifact[]> {
		if (!(await this.fs.exists(novelPaths.legacyDocumentsDir))) return [];
		const records: NovelDocumentArtifact[] = [];
		for (const file of (await this.fs.list(novelPaths.legacyDocumentsDir)).files) {
			const docId = file.split("/").pop()!.replace(/\.json$/u, "");
			if (!isDocumentId(docId)) continue;
			try {
				const raw = JSON.parse(await this.fs.read(file)) as Record<string, unknown>;
				if (raw.format !== "wb-novel-document-v1") continue;
				records.push(parseDocumentRecord({ ...raw, format: "wb-novel-source-v1" }, docId));
			} catch {
				// A record that cannot be read has nothing to carry over; its bundle is rebuilt from the engine.
			}
		}
		return records;
	}

	async readLegacyCorrections(): Promise<NovelCorrectionArtifact[]> {
		if (!(await this.fs.exists(LEGACY_CORRECTIONS_JSON_DIR))) return [];
		const items: NovelCorrectionArtifact[] = [];
		for (const file of (await this.fs.list(LEGACY_CORRECTIONS_JSON_DIR)).files) {
			if (!file.endsWith(".json")) continue;
			try {
				const raw = JSON.parse(await this.fs.read(file)) as Record<string, unknown>;
				if (raw.format !== "wb-novel-correction-v1" || typeof raw.id !== "string" || typeof raw.text !== "string") continue;
				items.push({ schemaVersion: 1, format: "wb-novel-correction-v1", id: raw.id, version: typeof raw.version === "number" ? raw.version : 1, text: raw.text, updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString() });
			} catch {
				// see above
			}
		}
		return items;
	}

	/** Every legacy per-row artifact file: Recanta names relative to the legacy root, with their text. */
	async readLegacyArtifacts(): Promise<PortableArtifact[]> {
		const artifacts: PortableArtifact[] = [];
		if (!(await this.fs.exists(novelPaths.legacyArtifactsDir))) return artifacts;
		const walk = async (folder: string): Promise<void> => {
			const listed = await this.fs.list(folder);
			for (const file of listed.files) {
				if (!file.endsWith(".json")) continue;
				try {
					artifacts.push({ name: file.slice(novelPaths.legacyArtifactsDir.length + 1), text: await this.fs.read(file) });
				} catch {
					// unreadable: not carried over, reported by the caller's verification
				}
			}
			for (const child of listed.folders) await walk(child);
		};
		await walk(novelPaths.legacyArtifactsDir);
		return artifacts;
	}

	async removeLegacyLayout(): Promise<void> {
		const removeTree = async (folder: string): Promise<void> => {
			if (!(await this.fs.exists(folder))) return;
			const listed = await this.fs.list(folder);
			for (const file of listed.files) await this.fs.remove(file);
			for (const child of listed.folders) await removeTree(child);
			await this.fs.remove(folder);
		};
		if (await this.fs.exists(novelPaths.legacyBookFile)) await this.fs.remove(novelPaths.legacyBookFile);
		await removeTree(novelPaths.legacyDocumentsDir);
		await removeTree(novelPaths.legacyArtifactsDir);
		await removeTree(LEGACY_CORRECTIONS_JSON_DIR);
	}

	// ---- local, disposable -------------------------------------------------

	static localDir(bookId: string): string {
		return `${NOVEL_LOCAL_DIR}/${bookId}`;
	}

	static localStatePath(bookId: string): string {
		return `${NovelKnowledgeStore.localDir(bookId)}/state.json`;
	}

	static localIndexPath(bookId: string): string {
		return `${NovelKnowledgeStore.localDir(bookId)}/${NOVEL_INDEX_FILE}`;
	}

	async readLocalState(bookId: string): Promise<NovelLocalState | null> {
		const path = NovelKnowledgeStore.localStatePath(bookId);
		if (!(await this.fs.exists(path))) return null;
		try {
			const raw = JSON.parse(await this.fs.read(path)) as Partial<NovelLocalState> & { schemaVersion?: unknown };
			if (!isRecord(raw) || raw.schemaVersion !== NOVEL_LOCAL_STATE_SCHEMA_VERSION || raw.bookId !== bookId) return null;
			const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
			const engine = isRecord(raw.engine) && typeof raw.engine.version === "string" && typeof raw.engine.schemaVersion === "number" && typeof raw.engine.indexVersion === "string"
				? { version: raw.engine.version, schemaVersion: raw.engine.schemaVersion, indexVersion: raw.engine.indexVersion }
				: null;
			return {
				schemaVersion: NOVEL_LOCAL_STATE_SCHEMA_VERSION,
				bookId,
				loaded: isRecord(raw.loaded) ? raw.loaded : {},
				corrections: isRecord(raw.corrections) ? raw.corrections : {},
				exportedVersion: typeof raw.exportedVersion === "number" && Number.isInteger(raw.exportedVersion) && raw.exportedVersion >= 0 ? raw.exportedVersion : 0,
				bundles: isRecord(raw.bundles) ? Object.fromEntries(Object.entries(raw.bundles).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {},
				divergent: strings(raw.divergent),
				engine,
				pending: Array.isArray(raw.pending) ? raw.pending.filter(isPendingItem) : [],
				lastError: typeof raw.lastError === "string" ? raw.lastError : null,
				updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
			};
		} catch {
			// Local state is disposable: anything unreadable is simply absent.
			return null;
		}
	}

	async writeLocalState(state: NovelLocalState): Promise<void> {
		await this.ensureLocalDir(state.bookId);
		await this.fs.write(NovelKnowledgeStore.localStatePath(state.bookId), stable(state));
	}

	/** The engine database bytes, or null when there are none or they cannot be read. */
	async readLocalIndex(bookId: string): Promise<Uint8Array | null> {
		const path = NovelKnowledgeStore.localIndexPath(bookId);
		if (!this.fs.readBinary || !(await this.fs.exists(path))) return null;
		try {
			return new Uint8Array(await this.fs.readBinary(path));
		} catch {
			return null;
		}
	}

	async writeLocalIndex(bookId: string, bytes: Uint8Array): Promise<void> {
		if (!this.fs.writeBinary) return;
		await this.ensureLocalDir(bookId);
		const copy = bytes.slice();
		await this.fs.writeBinary(NovelKnowledgeStore.localIndexPath(bookId), copy.buffer);
	}

	/** Throw the whole local index away: state, database, everything. */
	async clearLocalState(bookId: string): Promise<void> {
		for (const path of [NovelKnowledgeStore.localStatePath(bookId), NovelKnowledgeStore.localIndexPath(bookId)]) {
			if (await this.fs.exists(path)) await this.fs.remove(path);
		}
	}

	private async ensureLocalDir(bookId: string): Promise<void> {
		const dir = NovelKnowledgeStore.localDir(bookId);
		for (const path of [CACHE_DIR, NOVEL_LOCAL_DIR, dir]) if (!(await this.fs.exists(path))) await this.fs.mkdir(path);
	}

	// ---- helpers -----------------------------------------------------------

	private async ensureDirs(): Promise<void> {
		for (const path of [projectPaths.memoryDir, novelPaths.dir, novelPaths.sourcesDir, novelPaths.correctionsDir]) {
			if (!(await this.fs.exists(path))) await this.fs.mkdir(path);
		}
	}

	/** Write beside the target and rename over it where the platform allows, so a reader never sees half a file. */
	private async writeAtomic(path: string, text: string): Promise<void> {
		if (!this.fs.rename) {
			await this.fs.write(path, text);
			return;
		}
		const staging = stagingPath(path);
		await this.fs.write(staging, text);
		try {
			if (await this.fs.exists(path)) await this.fs.remove(path);
			await this.fs.rename(staging, path);
		} catch (error) {
			// A platform that cannot rename over the target still gets the whole text in one write.
			await this.fs.write(path, text);
			if (await this.fs.exists(staging)) await this.fs.remove(staging);
			if (!(await this.fs.exists(path))) throw error;
		}
	}

	/** An older plugin must not overwrite what a newer one wrote. */
	private async guardNewer(path: string, supported: number): Promise<void> {
		if (!(await this.fs.exists(path))) return;
		try {
			const front = parseFrontmatter(await this.fs.read(path));
			if (front && typeof front.schemaVersion === "number" && front.schemaVersion > supported) throw new NewerArtifactError(path, front.schemaVersion);
		} catch (error) {
			if (error instanceof NewerArtifactError) throw error;
			// Unparseable existing content is replaced; it protects nothing.
		}
	}

	private async readManaged<T>(path: string, marker: string, supported: number, parse: (front: Record<string, unknown>) => T): Promise<ArtifactReadResult<T>> {
		const read = await this.readManagedText(path);
		if (read.kind !== "loaded") return read;
		const parsed = parseManaged(read.value, marker, supported);
		if (parsed.kind !== "loaded") return parsed;
		try {
			return { kind: "loaded", value: parse(parsed.value.front) };
		} catch (error) {
			return { kind: "malformed", reason: error instanceof Error ? error.message : String(error) };
		}
	}
}

/** Where a managed file is written before it is renamed into place; never listed as a bundle. */
function stagingPath(path: string): string {
	return `${path}.writing.tmp`;
}

/** Corrections in the legacy layout were JSON in the same folder the Markdown ones use now. */
const LEGACY_CORRECTIONS_JSON_DIR = novelPaths.correctionsDir;

export class NewerArtifactError extends Error {
	constructor(readonly path: string, readonly schemaVersion: number) {
		super(`${path} was written by a newer Writing Buddy (schema ${schemaVersion}); leaving it untouched.`);
		this.name = "NewerArtifactError";
	}
}

export function documentRecordFrom(artifact: NovelDocumentArtifact): DocumentRecord {
	return {
		docId: artifact.docId,
		path: artifact.path,
		role: artifact.role,
		revision: artifact.revision,
		version: artifact.version,
		ordinal: artifact.ordinal,
		status: artifact.status,
		pov: artifact.pov,
		updatedAt: artifact.updatedAt,
	};
}

/** Content identity of a whole file, for skipping bundles this device already handled. */
export function contentHash(text: string): string {
	return `${text.length}:${fnv1a(text)}:${fnv1a(text.split("").reverse().join(""))}`;
}

// ---------------------------------------------------------------------------
// Managed Markdown: frontmatter of `key: <JSON>` lines, a body, fenced artifact blocks.
// ---------------------------------------------------------------------------

/** Frontmatter values are JSON, which YAML reads as flow style; the order is fixed so the same state is the same bytes. */
export function renderManaged(front: Record<string, unknown>, body: string): string {
	const lines = Object.entries(front).map(([key, value]) => `${key}: ${JSON.stringify(value === undefined ? null : value)}`);
	return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

export function parseFrontmatter(text: string): Record<string, unknown> | null {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text);
	if (!match) return null;
	const front: Record<string, unknown> = {};
	for (const line of match[1].split(/\r?\n/u)) {
		const colon = line.indexOf(": ");
		if (colon <= 0) {
			if (line.trim() === "") continue;
			return null;
		}
		const key = line.slice(0, colon).trim();
		try {
			front[key] = JSON.parse(line.slice(colon + 2));
		} catch {
			return null;
		}
	}
	return front;
}

function parseManaged(text: string, marker: string, supported: number): ArtifactReadResult<{ front: Record<string, unknown>; body: string }> {
	const front = parseFrontmatter(text);
	if (!front) return { kind: "malformed", reason: "not a managed Markdown file (frontmatter missing or torn)" };
	if (front[MANAGED_MARKER] !== marker) return { kind: "malformed", reason: `not a ${marker} file` };
	if (typeof front.schemaVersion !== "number") return { kind: "malformed", reason: "missing schemaVersion" };
	if (front.schemaVersion > supported) return { kind: "newer", schemaVersion: front.schemaVersion };
	const end = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u.exec(text)![0].length;
	return { kind: "loaded", value: { front, body: text.slice(end) } };
}

function renderBlocks(artifacts: readonly PortableArtifact[]): string {
	const ordered = [...artifacts].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
	if (ordered.length === 0) return "";
	return `\n## Knowledge\n\n${ordered.map((artifact) => `\`\`\`${FENCE} ${artifact.name}\n${artifact.text.trimEnd()}\n\`\`\``).join("\n\n")}\n`;
}

/** Every complete fenced artifact block; an unterminated last block (a torn write) is counted, not believed. */
export function parseBlocks(body: string): { artifacts: PortableArtifact[]; tornBlocks: number } {
	const artifacts: PortableArtifact[] = [];
	let tornBlocks = 0;
	const opener = new RegExp(`^\`\`\`${FENCE} (\\S+)[ \\t]*\\r?\\n`, "gmu");
	for (const match of body.matchAll(opener)) {
		const start = match.index + match[0].length;
		const close = body.indexOf("\n```", start);
		if (close === -1) {
			tornBlocks += 1;
			break;
		}
		const text = body.slice(start, close);
		const name = match[1];
		if (!/^[A-Za-z0-9][A-Za-z0-9._\-/]{0,511}$/u.test(name) || name.includes("..")) {
			tornBlocks += 1;
			continue;
		}
		try {
			JSON.parse(text);
		} catch {
			tornBlocks += 1;
			continue;
		}
		artifacts.push({ name, text: `${text}\n` });
	}
	return { artifacts, tornBlocks };
}

function renderSource(record: NovelDocumentArtifact, artifacts: readonly PortableArtifact[]): string {
	const front: Record<string, unknown> = {
		[MANAGED_MARKER]: "novel-source", schemaVersion: record.schemaVersion, format: record.format,
		docId: record.docId, path: record.path, role: record.role, status: record.status,
		revision: record.revision, version: record.version, ordinal: record.ordinal, pov: record.pov,
		chunks: record.chunks, engine: record.engine, writer: record.writer, updatedAt: record.updatedAt,
	};
	const title = record.path.split("/").pop()?.replace(/\.md$/iu, "") ?? record.docId;
	return renderManaged(front, `# ${title}\n\n${MANAGED_NOTE}\n\nSource: \`${record.path}\` (${record.role}, ${record.status}). ${artifacts.length} knowledge block(s).\n${renderBlocks(artifacts)}`);
}

function parseBook(front: Record<string, unknown>): NovelBookRecord {
	if (typeof front.bookId !== "string" || !/^[a-z0-9]{4,32}$/u.test(front.bookId)) throw new Error("not a project record");
	const bootstrap = isRecord(front.bootstrap) ? front.bootstrap : {};
	return {
		schemaVersion: NOVEL_PROJECT_SCHEMA_VERSION,
		format: "wb-novel-project-v1",
		bookId: front.bookId,
		manuscriptRoot: typeof front.manuscriptRoot === "string" ? front.manuscriptRoot : "",
		canonPaths: Array.isArray(front.canonPaths) ? front.canonPaths.filter((item): item is string => typeof item === "string") : [],
		bootstrap: bootstrap.status === "complete"
			? { status: "complete", completedAt: typeof bootstrap.completedAt === "string" ? bootstrap.completedAt : null }
			: { status: "pending", completedAt: null },
		engine: parseEngine(front.engine),
		createdAt: typeof front.createdAt === "string" ? front.createdAt : new Date(0).toISOString(),
		updatedAt: typeof front.updatedAt === "string" ? front.updatedAt : new Date(0).toISOString(),
	};
}

function parseEngine(value: unknown): EngineIdentity | null {
	if (!isRecord(value) || typeof value.name !== "string" || typeof value.version !== "string" || typeof value.schemaVersion !== "number" || typeof value.artifactFormat !== "number") return null;
	return { name: value.name, version: value.version, schemaVersion: value.schemaVersion, artifactFormat: value.artifactFormat };
}

function parseDocumentRecord(front: Record<string, unknown>, docId: string): NovelDocumentArtifact {
	if (front.format !== "wb-novel-source-v1") throw new Error("not a source record");
	if (front.docId !== docId) throw new Error("document id does not match its file name");
	if (typeof front.path !== "string" || !front.path || front.path.includes("..") || front.path.startsWith("/") || /^[A-Za-z]:/u.test(front.path)) throw new Error("missing or unsafe path");
	if (front.role !== "manuscript" && front.role !== "canon") throw new Error("unknown role");
	const chunks = Array.isArray(front.chunks) ? front.chunks : [];
	return {
		schemaVersion: NOVEL_SOURCE_SCHEMA_VERSION,
		format: "wb-novel-source-v1",
		docId,
		path: front.path,
		role: front.role,
		status: front.status === "deleted" ? "deleted" : "active",
		revision: typeof front.revision === "string" ? front.revision : null,
		version: typeof front.version === "number" && Number.isInteger(front.version) && front.version >= 0 ? front.version : 0,
		ordinal: typeof front.ordinal === "number" && Number.isInteger(front.ordinal) ? front.ordinal : null,
		pov: typeof front.pov === "string" ? front.pov : null,
		chunks: chunks.filter(isChunkRecord),
		engine: parseEngine(front.engine),
		writer: typeof front.writer === "string" ? front.writer : "",
		updatedAt: typeof front.updatedAt === "string" ? front.updatedAt : new Date(0).toISOString(),
	};
}

function isChunkRecord(value: unknown): value is NovelChunkRecord {
	if (!isRecord(value)) return false;
	return Number.isInteger(value.index) && typeof value.revision === "string" && (value.heading === null || typeof value.heading === "string");
}

function isPendingItem(value: unknown): value is NovelPendingItem {
	if (!isRecord(value)) return false;
	switch (value.kind) {
		case "document": case "delete": case "artifact": return typeof value.path === "string";
		case "rename": return typeof value.path === "string" && typeof value.oldPath === "string";
		case "rebuild": return true;
		default: return false;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Deterministic JSON for the local state file. */
function stable(value: unknown): string {
	const ordered = (item: unknown): unknown => {
		if (Array.isArray(item)) return item.map(ordered);
		if (!isRecord(item)) return item;
		return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, inner]) => [key, ordered(inner)]));
	};
	return `${JSON.stringify(ordered(value), null, "\t")}\n`;
}
