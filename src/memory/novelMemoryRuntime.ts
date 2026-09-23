/**
 * Novel memory as the plugin runs it.
 *
 * Composes the store, the engine and the lifecycle over the plugin's own
 * Vault access, and answers the two questions the rest of the plugin asks:
 * what is the state (for a status line and a retry button, nothing more) and
 * what does the book know that this turn should see.
 *
 * **Where the engine comes from.** Recanta's kernel runs on an injected
 * SQLite driver; inside Obsidian that is SQLite-WASM, bundled into `main.js`
 * (`recantaEngine.ts`). The database bytes live in the disposable cache. The
 * engine needs an extraction provider to learn anything new; the plugin
 * builds one from the writer's default connection (`backendExtraction.ts`).
 * Tests hand in a deterministic provider through the same seam.
 */

import type { ExtractionProvider, Vocabulary } from "recanta-dev";
import type { EvidenceItem } from "../context/evidence";
import type { VaultFs } from "../storage/paths";
import { chunkManuscript, frontmatterValue, stripFrontmatter } from "./chunking";
import { ExtractionAvailability } from "./extractionAvailability";
import { NovelKnowledgeStore } from "./NovelKnowledgeStore";
import { type EngineSession, type NovelBuildScope, type NovelMemoryEvent, type NovelMemoryReader, type NovelMemoryStatus, NovelMemoryLifecycle } from "./NovelMemoryLifecycle";
import { novelContextEvidence } from "./renderNovelContext";
import { DEFAULT_PREDICATE_VOCABULARY, type StoryPosition } from "./novelKinds";
import type { EngineFactory } from "./recantaEngine";
import { WritingBuddyRecantaAdapter } from "./WritingBuddyRecantaAdapter";

export interface NovelMemoryRuntimeOptions {
	fs: VaultFs;
	reader: NovelMemoryReader & { activeFileText?(): string | null };
	/** The version string written into records, for diagnostics. */
	writer: string;
	/** Opens the engine; absent means this build has none. */
	engine?: EngineFactory | null;
	/**
	 * The extraction provider the engine is configured with, resolved when the
	 * engine opens; null means no model can be asked, and only artifacts from
	 * other devices can teach this one anything.
	 */
	extraction?: (() => ExtractionProvider | null) | null;
	vocabulary?: Vocabulary;
	onStatus?: (status: NovelMemoryStatus) => void;
	now?: () => number;
	debounceMs?: number;
	externalDebounceMs?: number;
	/** Timer primitives, injectable so tests drive time. */
	setTimer?: (callback: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
	/** How many documents may be read by the model side by side; one by default, asked before every batch. */
	concurrency?: number | (() => number);
}

/**
 * Documents in flight at once on a desktop with a hosted connection: the
 * gateway sees a few streams, not a storm. The chunks of one document stay
 * in order, so the longest document bounds the pass however many run
 * beside it; six takes most of what that bound allows on a long novel.
 */
export const DEFAULT_NOVEL_MEMORY_CONCURRENCY = 6;

export interface TurnMemoryRequest {
	question: string;
	activeFilePath: string | null;
	/** The live editor text, so the position is the writer's, not the saved file's. */
	activeFileText?: string | null;
	cursorOffset?: number | null;
}

/** Recanta needs a provider even when nothing may be asked; this one refuses, and the run stays retryable. */
const NO_MODEL: ExtractionProvider = {
	fingerprint: "writing-buddy-no-model",
	method: "model",
	extract: () => Promise.reject(new Error("No AI connection is configured for novel knowledge.")),
};

export class NovelMemoryRuntime {
	readonly store: NovelKnowledgeStore;
	readonly lifecycle: NovelMemoryLifecycle;
	/** Shared by the extraction provider (which reports answers) and the lifecycle (which asks before calling). */
	readonly availability: ExtractionAvailability;

	constructor(private readonly options: NovelMemoryRuntimeOptions) {
		this.store = new NovelKnowledgeStore(options.fs, options.writer);
		const engine = options.engine ?? null;
		this.availability = new ExtractionAvailability(options.now ?? Date.now);
		this.lifecycle = new NovelMemoryLifecycle({
			fs: options.fs,
			reader: options.reader,
			store: this.store,
			availability: this.availability,
			openEngine: engine ? (bookId, bytes) => this.openEngine(engine, bookId, bytes) : null,
			...(options.now ? { now: options.now } : {}),
			...(options.onStatus ? { onStatus: options.onStatus } : {}),
			...(options.debounceMs !== undefined ? { debounceMs: options.debounceMs } : {}),
			...(options.externalDebounceMs !== undefined ? { externalDebounceMs: options.externalDebounceMs } : {}),
			...(options.setTimer ? { setTimer: options.setTimer } : {}),
			...(options.clearTimer ? { clearTimer: options.clearTimer } : {}),
			...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
		});
	}

	/**
	 * Open the book if there is one and reconcile it with the Vault. Chapter
	 * updates left from last time run now; an unfinished whole-book pass is
	 * held until the writer resumes it (`flush()` returns at once while held).
	 */
	async start(): Promise<void> {
		await this.lifecycle.start();
		if (this.lifecycle.isConfigured) void this.lifecycle.flush();
	}

	/** Stop the current pass at the next chunk; what was retained stays. */
	pause(): void {
		this.lifecycle.pause();
	}

	/** Continue a held pass. */
	async resume(): Promise<void> {
		await this.lifecycle.resume();
	}

	get isPaused(): boolean {
		return this.lifecycle.isPaused;
	}

	status(): NovelMemoryStatus {
		return this.lifecycle.status();
	}

	/** An engine exists in this build; whether a model can be asked is a separate, per-turn question. */
	get engineAvailable(): boolean {
		return this.options.engine != null;
	}

	get extractionAvailable(): boolean {
		return this.options.extraction?.() != null;
	}

	/**
	 * First bootstrap of an existing or new novel: the manuscript scope is the
	 * top-level folder of the file the writer is in, and canon is any sibling
	 * folder whose name says so. Both are recorded in the book file, which the
	 * writer may edit; nothing is inferred again afterwards.
	 */
	async bootstrapFrom(activeFilePath: string, allFiles: readonly string[]): Promise<{ manuscriptRoot: string; canonPaths: string[] }> {
		const scope = NovelMemoryRuntime.inferScope(activeFilePath, allFiles);
		await this.lifecycle.bootstrap(scope);
		void this.lifecycle.flush();
		return scope;
	}

	/** The scope `bootstrapFrom` would record, without recording it. */
	static inferScope(activeFilePath: string, allFiles: readonly string[]): { manuscriptRoot: string; canonPaths: string[] } {
		const manuscriptRoot = activeFilePath.includes("/") ? activeFilePath.split("/")[0] : "";
		const folders = new Set(allFiles.filter((path) => path.includes("/")).map((path) => path.split("/")[0]));
		const canonPaths = [...folders].filter((folder) => folder !== manuscriptRoot && /设定|人物|世界观|canon|world|character|lore/iu.test(folder)).sort();
		return { manuscriptRoot, canonPaths };
	}

	/** How much a first build from this chapter would read: shown to the writer before anything is asked. */
	measureScopeFrom(activeFilePath: string, allFiles: readonly string[]): Promise<NovelBuildScope> {
		return this.lifecycle.measureScope(NovelMemoryRuntime.inferScope(activeFilePath, allFiles));
	}

	notify(event: NovelMemoryEvent): void {
		this.lifecycle.notify(event);
	}

	async rebuild(): Promise<void> {
		await this.lifecycle.rebuild();
	}

	async retry(): Promise<void> {
		await this.lifecycle.retryFailures();
	}

	/**
	 * What the book knows that this turn should see: knowledge at or before
	 * the writer's position in the manuscript, from the point of view the
	 * chapter declares. Null when there is no engine, no book, or nothing
	 * relevant — the turn then proceeds exactly as it did before memory.
	 */
	async contextFor(request: TurnMemoryRequest): Promise<EvidenceItem | null> {
		const adapter = this.lifecycle.adapter;
		if (!adapter || !this.lifecycle.isConfigured || !request.question.trim()) return null;
		const position = this.positionOf(request);
		const pov = request.activeFileText ? frontmatterValue(stripFrontmatter(request.activeFileText).frontmatter, "pov") : null;
		try {
			const context = await adapter.recall({ query: request.question, position, pov });
			return novelContextEvidence(context);
		} catch {
			// Memory is an aid, never a gate: a failed recall costs the turn nothing.
			return null;
		}
	}

	/** The writer's place in the story, from the document they are in and where their cursor is. */
	positionOf(request: TurnMemoryRequest): StoryPosition | null {
		if (!request.activeFilePath) return null;
		const record = this.lifecycle.documentRecords.find((item) => item.path === request.activeFilePath && item.status === "active" && item.role === "manuscript");
		if (!record || record.ordinal === null) return null;
		const text = request.activeFileText ?? null;
		if (!text || request.cursorOffset === null || request.cursorOffset === undefined) {
			// Without a cursor, the whole chapter is in scope: its last chunk.
			return { ordinal: record.ordinal, chunk: Number.MAX_SAFE_INTEGER };
		}
		const chunks = chunkManuscript(text);
		const index = chunks.findIndex((chunk) => request.cursorOffset! < chunk.end);
		return { ordinal: record.ordinal, chunk: index === -1 ? Math.max(0, chunks.length - 1) : index };
	}

	/** Save the local index and release the engine. */
	async dispose(): Promise<void> {
		try {
			await this.lifecycle.persist();
		} finally {
			this.lifecycle.close();
		}
	}

	private async openEngine(factory: EngineFactory, bookId: string, bytes: Uint8Array | null): Promise<EngineSession> {
		const provider = this.options.extraction?.() ?? NO_MODEL;
		const handle = await factory({ provider, bytes, vocabulary: this.options.vocabulary ?? { predicates: DEFAULT_PREDICATE_VOCABULARY } });
		const adapter = new WritingBuddyRecantaAdapter(handle.engine, bookId);
		return { adapter, exportBytes: () => handle.exportBytes(), close: () => handle.close(), recovered: (handle as { recovered?: boolean }).recovered === true };
	}
}
