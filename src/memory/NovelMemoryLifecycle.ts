/**
 * How a manuscript becomes, and stays, novel knowledge.
 *
 * The lifecycle listens to what the Vault says happened — a file was created,
 * modified, deleted or renamed, or a knowledge bundle arrived from another
 * device — and turns each into bounded work: read the current text, cut it
 * into chunks, hand each chunk to Recanta as a document revision by stable
 * identity, retire chunks that left, and pack what Recanta produced into the
 * document's bundle so other devices can unpack it. Every step is idempotent
 * and the queue is persisted before it is worked, so a plugin that is closed
 * mid-way picks up where it stopped.
 *
 * What it deliberately does not do: analyze the whole book on every request
 * (bootstrap and rebuild are the only whole-book passes), retain anything the
 * writer has not put in the manuscript (a candidate lives in a conversation,
 * which is not manuscript), ask a model for text whose extraction another
 * device already synchronized (Recanta recognises the revision and answers
 * from the artifacts), read its own bundles back as if they were news, or
 * arbitrate memory itself (deletion, restoration, supersession and
 * reconciliation are Recanta's; this file only reports what the Vault did).
 *
 * The first build is hours of model calls, so it runs only while the writer
 * says so: `pause()` stops any pass at the next chunk and keeps everything
 * retained so far; a plugin that reopens with the first build unfinished
 * holds it and waits for `resume()` instead of continuing unasked. Updates
 * to single chapters after the first build are small and still run by
 * themselves, as does a rebuild, which replays from the bundles.
 *
 * Documents at the head of the queue are delivered side by side, up to the
 * configured concurrency; the chunks of one document stay in order. Before
 * a batch runs, every document in it is prepared in queue order — record,
 * position, whether it changed at all — so no document's position moves
 * under another while both are being retained. Recanta orders positioned
 * sources by position, not by arrival, so the order in which the batch
 * finishes does not matter to it.
 */

import type { DocumentReceipt, PortableArtifact } from "recanta-dev";
import { contentRevision } from "../context/revision";
import { hasExplicitArchiveMetadata, isEligibleContextPath, isInternalContextPath, isWithinContextRoot, normaliseVaultPath } from "../context/eligibility";
import type { VaultFs } from "../storage/paths";
import { type ManuscriptChunk, chunkManuscript, stripFrontmatter } from "./chunking";
import type { ExtractionAvailability } from "./extractionAvailability";
import { type DocumentRecord, type DocumentRole, assignOrdinals, declaredOrdinal, declaredPov, documentIdFor, matchRenameByContent } from "./documentIdentity";
import { type EngineIdentity, type NovelBookRecord, type NovelCorrectionArtifact, type NovelDocumentArtifact, type NovelLocalState, type NovelPendingItem, NovelKnowledgeStore, contentHash, documentRecordFrom, novelPaths } from "./NovelKnowledgeStore";
import { slug } from "./novelKinds";
import type { WritingBuddyRecantaAdapter } from "./WritingBuddyRecantaAdapter";

/**
 * The model cannot be asked right now. Not a failure of the document it
 * interrupted: the queue keeps it and delivers it again when the wait is over.
 */
class ExtractionPausedError extends Error {
	constructor(reason: string) { super(reason); this.name = "ExtractionPausedError"; }
}

/** The writer paused the build. The item being worked stays at the head of the queue; what was retained stays retained. */
class BuildHeldError extends Error {
	constructor() { super("Novel knowledge is paused."); this.name = "BuildHeldError"; }
}

/** Recanta's errors carry a code; anything else is treated as a plain failure. */
function errorCode(error: unknown): string | null {
	if (typeof error !== "object" || error === null || !("code" in error)) return null;
	const code: unknown = error.code;
	return typeof code === "string" ? code : null;
}

export interface NovelMemoryEvent {
	kind: "create" | "modify" | "delete" | "rename";
	path: string;
	oldPath?: string;
	/**
	 * True when the change did not come from this device's editor — a sync
	 * delivery, an external tool. Such text usually arrives with the other
	 * device's knowledge close behind, so it waits longer before extraction;
	 * if the knowledge lands first, Recanta recognises the revision and no
	 * model is asked at all.
	 */
	external?: boolean;
}

export type NovelMemoryState =
	| "unconfigured"
	| "unavailable"
	| "building"
	| "updating"
	| "updated"
	| "partial"
	| "rebuilding"
	/** Queued work is waiting for the writer's Resume; nothing is being asked. */
	| "paused";

/** How far the current pass is: documents worked over documents queued, and the chunk being delivered inside the current one. */
export interface NovelMemoryProgress {
	done: number;
	total: number;
	chunk: number | null;
	chunks: number | null;
}

/** What a whole-book pass would read, measured before anything is written or asked. */
export interface NovelBuildScope {
	manuscripts: number;
	canon: number;
	/** Model calls the pass would make: one per manuscript chunk, one per canon note. */
	chunks: number;
	chars: number;
}

export interface NovelMemoryStatus {
	state: NovelMemoryState;
	pending: number;
	failures: Array<{ path: string; reason: string }>;
	/** Documents another device recorded whose manuscript text has not arrived here yet. */
	awaitingManuscript: number;
	lastUpdatedAt: string | null;
	detail: string | null;
	/** While the model is unavailable: when the queue will be worked again. */
	pausedUntil: string | null;
	/** Present while a pass has work in it; null when the queue is idle. */
	progress: NovelMemoryProgress | null;
	/** True while the queued work is a whole-book pass (the first build or a rebuild) rather than a chapter update. */
	wholeBook: boolean;
}

export interface NovelMemoryReader {
	listMarkdownFiles(): string[];
	read(path: string): Promise<string>;
}

/** The engine as the lifecycle sees it: something that can be opened, saved and thrown away. */
export interface EngineSession {
	adapter: WritingBuddyRecantaAdapter;
	/** Database bytes to persist; null for engines that persist themselves. */
	exportBytes(): Uint8Array | null;
	close(): void;
	/** True when stored bytes existed but could not be used, so the index must be rebuilt. */
	recovered: boolean;
}

export interface NovelMemoryLifecycleOptions {
	fs: VaultFs;
	reader: NovelMemoryReader;
	store: NovelKnowledgeStore;
	/**
	 * Opens the engine over persisted bytes (or fresh when null). Absent when
	 * no engine is available in this build; the lifecycle then only keeps
	 * books and records.
	 */
	openEngine?: ((bookId: string, bytes: Uint8Array | null) => Promise<EngineSession>) | null;
	now?: () => number;
	/** Timer primitive, injectable so tests drive time. */
	setTimer?: (callback: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
	debounceMs?: number;
	/** How long a change that did not come from this editor waits for its knowledge bundle. */
	externalDebounceMs?: number;
	maxChunkChars?: number;
	/**
	 * Whether the extraction model may be asked; consulted before every call.
	 * While it says no, the queue waits instead of delivering into refusals.
	 */
	availability?: ExtractionAvailability;
	/** How many documents may be delivered side by side; one by default. Read before every batch. */
	concurrency?: number | (() => number);
	onStatus?: (status: NovelMemoryStatus) => void;
}

/** A document read and placed, ready to be delivered: the part of processing that must happen in queue order. */
interface PreparedDocument {
	record: DocumentRecord;
	text: string;
	revision: string;
	wasDeleted: boolean;
	/** Documents whose position moved when this one was placed. */
	positionsChanged: Set<string>;
}

export interface BootstrapOptions {
	manuscriptRoot: string;
	canonPaths?: string[];
	bookId?: string;
}

export interface ProcessReport {
	processed: string[];
	unchanged: string[];
	deleted: string[];
	renamed: Array<{ from: string; to: string }>;
	/** Documents whose text Recanta already knew (from bundles or an earlier delivery): no extraction ran. */
	replayed: string[];
	/** Recanta artifacts applied from bundles. */
	imported: number;
	/** Bundles written. */
	exported: number;
	failures: Array<{ path: string; reason: string }>;
}

/** The outcome of carrying the pre-Markdown layout over, kept for the status line and tests. */
export interface MigrationReport {
	bundles: number;
	artifacts: number;
	/** Legacy artifacts that could not be verified in a bundle; the legacy files are kept when this is non-empty. */
	unverified: string[];
	retired: boolean;
}

export class NovelMemoryLifecycle {
	private book: NovelBookRecord | null = null;
	private local: NovelLocalState | null = null;
	private readonly records = new Map<string, DocumentRecord>();
	private readonly documents = new Map<string, NovelDocumentArtifact>();
	/** Recanta artifacts per bundle key (document id or `corr:<slug>`), by name; loaded from bundles, extended by exports. */
	private readonly bundleArtifacts = new Map<string, Map<string, string>>();
	/** Bundles whose record or artifacts changed since they were last written. */
	private readonly dirtyBundles = new Set<string>();
	private readonly corrections = new Map<string, NovelCorrectionArtifact>();
	private readonly timers = new Map<string, unknown>();
	private readonly queue: NovelPendingItem[] = [];
	private chain: Promise<void> = Promise.resolve();
	private working = false;
	private session: EngineSession | null = null;
	private failures = new Map<string, string>();
	/** Records whose manuscript text is not in the Vault (yet). */
	private readonly missing = new Set<string>();
	/** Documents whose bundle a newer plugin wrote; left alone until that plugin runs here. */
	private readonly newerSchema = new Set<string>();
	/** Artifacts whose dependencies have not arrived; retried after every delivery. */
	private readonly pendingArtifacts = new Map<string, PortableArtifact>();
	private lastUpdatedAt: string | null = null;
	private rebuilding = false;
	private dirty = false;
	/** Scheduled to work the queue again once the model may be asked. */
	private resumeTimer: unknown = null;
	/** The writer's hold: while true the queue is kept, not worked. */
	private held = false;
	/** Documents worked since the queue was last empty; with what is still queued, the pass's progress. */
	private passDone = 0;
	/** The chunk being delivered inside each document in flight, by document id. */
	private readonly chunkProgress = new Map<string, { chunk: number; chunks: number }>();
	/** How many items at the head of the queue are being worked right now. */
	private inFlight = 0;
	migration: MigrationReport | null = null;
	private readonly now: () => number;
	private readonly debounceMs: number;
	private readonly externalDebounceMs: number;

	constructor(private readonly options: NovelMemoryLifecycleOptions) {
		this.now = options.now ?? Date.now;
		this.debounceMs = options.debounceMs ?? 800;
		this.externalDebounceMs = options.externalDebounceMs ?? 60_000;
	}

	// ---- state -------------------------------------------------------------

	get bookId(): string | null {
		return this.book?.bookId ?? null;
	}

	get isConfigured(): boolean {
		return this.book !== null;
	}

	get adapter(): WritingBuddyRecantaAdapter | null {
		return this.session?.adapter ?? null;
	}

	get documentRecords(): readonly DocumentRecord[] {
		return [...this.records.values()];
	}

	get bootstrapComplete(): boolean {
		return this.book?.bootstrap.status === "complete";
	}

	status(): NovelMemoryStatus {
		const failures = [...this.failures].map(([path, reason]) => ({ path, reason }));
		const pending = this.queue.length + this.timers.size;
		let state: NovelMemoryState;
		if (!this.book) state = "unconfigured";
		else if (!this.session && !this.options.openEngine) state = "unavailable";
		else if (this.rebuilding) state = "rebuilding";
		else if (this.held && pending > 0) state = "paused";
		else if (pending > 0 || this.working) state = this.book.bootstrap.status === "complete" ? "updating" : "building";
		else if (failures.length > 0) state = "partial";
		else if (this.book.bootstrap.status !== "complete") state = "building";
		else state = "updated";
		const pausedUntil = this.options.availability?.pausedUntil ?? null;
		const detail = (pausedUntil ? this.options.availability?.reason : null) ?? this.local?.lastError ?? null;
		let chunk: number | null = null;
		let chunks: number | null = null;
		for (const item of this.chunkProgress.values()) {
			chunk = (chunk ?? 0) + item.chunk;
			chunks = (chunks ?? 0) + item.chunks;
		}
		const progress = pending > 0 || this.working
			? { done: this.passDone, total: this.passDone + pending, chunk, chunks }
			: null;
		return { state, pending, failures, awaitingManuscript: this.missing.size, lastUpdatedAt: this.lastUpdatedAt, detail, pausedUntil, progress, wholeBook: this.wholeBookPending() };
	}

	/** The queued work reads the whole book: the first build has not completed, or a rebuild is queued. */
	private wholeBookPending(): boolean {
		if (!this.book) return false;
		return this.book.bootstrap.status !== "complete" || this.queue.some((item) => item.kind === "rebuild");
	}

	get isPaused(): boolean {
		return this.held;
	}

	/**
	 * Stop asking at the next chunk. The document being worked stays at the
	 * head of the queue and every chunk already retained stays in the engine,
	 * so `resume()` pays only for what was not delivered yet.
	 */
	pause(): void {
		if (this.held) return;
		this.held = true;
		this.publish();
	}

	/** Work the queue again; the writer's answer to a held pass. */
	resume(): Promise<ProcessReport> {
		this.held = false;
		return this.flush();
	}

	/**
	 * What a whole-book pass over this scope would read: file and chunk counts
	 * from the current Vault, using the same eligibility as the pass itself.
	 * Nothing is written and nothing is asked.
	 */
	async measureScope(input: BootstrapOptions): Promise<NovelBuildScope> {
		const scope = { manuscriptRoot: normaliseVaultPath(input.manuscriptRoot), canonPaths: (input.canonPaths ?? []).map(normaliseVaultPath) };
		const out: NovelBuildScope = { manuscripts: 0, canon: 0, chunks: 0, chars: 0 };
		for (const path of this.options.reader.listMarkdownFiles()) {
			const role = classifyPath(normaliseVaultPath(path), scope);
			if (!role) continue;
			let text: string;
			try { text = await this.options.reader.read(path); } catch { continue; }
			if (role === "manuscript" && hasExplicitArchiveMetadata(text)) continue;
			out.chars += stripFrontmatter(text).text.length;
			if (role === "manuscript") {
				out.manuscripts += 1;
				out.chunks += chunkManuscript(text, this.options.maxChunkChars).length;
			} else {
				out.canon += 1;
				out.chunks += 1;
			}
		}
		return out;
	}

	// ---- start-up ----------------------------------------------------------

	/**
	 * Carry a pre-Markdown layout over if one is present, load the project
	 * and every bundle, open the engine over its persisted bytes, take in
	 * every bundle this device has not applied, then reconcile with what is
	 * actually in the Vault: text that changed while the plugin was closed is
	 * queued, files that vanished are deleted, pending work from the previous
	 * run is re-queued. Nothing is retained here; `flush()` does the work.
	 */
	async start(): Promise<void> {
		await this.migrateLegacyRecords();
		const book = await this.options.store.readBook();
		if (book.kind !== "loaded") {
			this.book = null;
			this.publish();
			return;
		}
		this.book = book.value;
		await this.loadBundles();
		this.local = (await this.options.store.readLocalState(this.book.bookId)) ?? this.emptyLocal(this.book.bookId);
		await this.openEngine();
		for (const item of this.local.pending) this.enqueue(item);
		this.local.pending = [];
		await this.migrateLegacyArtifacts();
		if (this.session && !this.rebuildQueued()) await this.takeInBundles();
		await this.reconcileWithVault();
		// A first build that did not finish last time is the writer's to continue, not this start's.
		// A queued rebuild is not held: it replays from the bundles and asks a model only for text they lack.
		if (this.queue.length > 0 && this.book.bootstrap.status !== "complete") this.held = true;
		this.publish();
	}

	/**
	 * Choose the manuscript and its canon, write the project manifest, and queue
	 * the whole scope. The one whole-book pass a book needs; `flush()` runs it.
	 */
	async bootstrap(input: BootstrapOptions): Promise<void> {
		await this.migrateLegacyRecords();
		const bookId = input.bookId ?? this.bookIdFor(input.manuscriptRoot);
		const at = new Date(this.now()).toISOString();
		const existing = await this.options.store.readBook();
		this.book = {
			schemaVersion: 1,
			format: "wb-novel-project-v1",
			bookId,
			manuscriptRoot: normaliseVaultPath(input.manuscriptRoot),
			canonPaths: (input.canonPaths ?? []).map(normaliseVaultPath),
			bootstrap: { status: "pending", completedAt: null },
			engine: existing.kind === "loaded" ? existing.value.engine : null,
			createdAt: existing.kind === "loaded" ? existing.value.createdAt : at,
			updatedAt: at,
		};
		await this.options.store.writeBook(this.book);
		this.held = false;
		if (this.records.size === 0) await this.loadBundles();
		if (!this.local || this.local.bookId !== bookId) this.local = (await this.options.store.readLocalState(bookId)) ?? this.emptyLocal(bookId);
		await this.openEngine();
		await this.migrateLegacyArtifacts();
		if (this.session && !this.rebuildQueued()) await this.takeInBundles();
		await this.reconcileWithVault();
		this.publish();
	}

	// ---- events ------------------------------------------------------------

	/** A Vault event. Debounced per path; a burst of saves becomes one unit of work. */
	notify(event: NovelMemoryEvent): void {
		if (!this.book) return;
		const path = normaliseVaultPath(event.path);
		const oldPath = event.oldPath ? normaliseVaultPath(event.oldPath) : undefined;
		let item: NovelPendingItem | null = null;
		if (NovelKnowledgeStore.isManagedPath(path)) {
			// Only the files this store writes are news; a staged copy or a stray file under the folder is not.
			if (event.kind !== "delete" && (NovelKnowledgeStore.isSourceBundlePath(path) || NovelKnowledgeStore.isCorrectionBundlePath(path) || path === novelPaths.projectFile)) item = { kind: "artifact", path, ...(event.kind === "modify" ? { changed: true } : {}) };
		} else if (event.kind === "rename" && oldPath) {
			if (this.isTracked(oldPath) || this.classify(path) !== null) item = { kind: "rename", path, oldPath };
		} else if (event.kind === "delete") {
			if (this.isTracked(path)) item = { kind: "delete", path };
		} else if (this.classify(path) !== null) {
			item = { kind: "document", path };
		}
		if (!item) return;
		const key = `${item.kind}:${path}`;
		const setTimer = this.options.setTimer ?? ((callback, ms) => window.setTimeout(callback, ms));
		const clearTimer = this.options.clearTimer ?? ((handle) => window.clearTimeout(handle as number));
		const previous = this.timers.get(key);
		if (previous !== undefined) clearTimer(previous);
		const pending = item;
		const delay = item.kind === "document" && event.external ? this.externalDebounceMs : this.debounceMs;
		this.timers.set(key, setTimer(() => {
			this.timers.delete(key);
			this.enqueue(pending);
			void this.flush();
		}, delay));
		this.publish();
	}

	/** Explicit whole-index rebuild: the low-frequency recovery action. */
	async rebuild(): Promise<ProcessReport> {
		if (!this.book) throw new Error("No book is configured.");
		this.enqueue({ kind: "rebuild" });
		this.held = false;
		return this.flush();
	}

	/** Retry everything that failed last time. */
	async retryFailures(): Promise<ProcessReport> {
		for (const path of this.failures.keys()) {
			if (NovelKnowledgeStore.isManagedPath(path)) this.enqueue({ kind: "artifact", path, changed: true });
			else this.enqueue({ kind: "document", path });
		}
		this.failures.clear();
		this.held = false;
		return this.flush();
	}

	/** Record an explicit correction from the writer; it outranks canon and manuscript. */
	async correct(id: string, text: string): Promise<void> {
		if (!this.book) throw new Error("No book is configured.");
		const existing = this.corrections.get(id);
		const record: NovelCorrectionArtifact = {
			schemaVersion: 1, format: "wb-novel-correction-v1", id, version: (existing?.version ?? 0) + 1, text, updatedAt: new Date(this.now()).toISOString(),
		};
		this.corrections.set(id, record);
		this.dirtyBundles.add(`corr:${slug(id)}`);
		await this.writeBundles();
		this.enqueue({ kind: "artifact", path: NovelKnowledgeStore.correctionPath(id), changed: true });
		await this.flush();
	}

	/**
	 * Work the queue to empty. Items are processed one at a time in arrival
	 * order; the queue is persisted before each item so a restart resumes.
	 * When the queue is empty, new local knowledge is packed into bundles and
	 * the database bytes are saved.
	 */
	flush(): Promise<ProcessReport> {
		const report: ProcessReport = { processed: [], unchanged: [], deleted: [], renamed: [], replayed: [], imported: 0, exported: 0, failures: [] };
		const run = this.chain.then(async () => {
			if (!this.book || !this.local) return report;
			this.working = true;
			this.publish();
			try {
				while (this.queue.length > 0) {
					if (this.held) break;
					if (this.pauseWhileUnavailable()) break;
					const batch = this.nextBatch();
					this.inFlight = batch.length;
					this.local.pending = [...this.queue];
					await this.persistLocal();
					const outcomes = await this.workBatch(batch, report);
					this.inFlight = 0;
					// Finished items leave the queue; a paused or held item stays, in its place, for the next pass.
					const kept = batch.filter((item) => outcomes.get(item) !== "done");
					this.queue.splice(0, batch.length, ...kept);
					this.passDone += batch.length - kept.length;
					this.publish();
					if (batch.some((item) => outcomes.get(item) === "paused")) {
						// Nothing about the paused items failed. While the connection asks for a wait, one timer
						// works the queue again; if another call answered since and cleared it, they go again now.
						if (this.pauseWhileUnavailable()) break;
						continue;
					}
					if (kept.length > 0) break;
				}
				if (this.queue.length === 0) this.passDone = 0;
				this.local.pending = [...this.queue];
				if (this.session) {
					await this.retryPendingArtifacts(report);
					this.exportArtifacts();
				}
				report.exported += await this.writeBundles();
				if (this.book.bootstrap.status !== "complete" && this.session && this.queue.length === 0 && this.failures.size === 0 && report.failures.length === 0) {
					this.book = { ...this.book, bootstrap: { status: "complete", completedAt: new Date(this.now()).toISOString() }, engine: this.engineIdentity(), updatedAt: new Date(this.now()).toISOString() };
					await this.options.store.writeBook(this.book);
				}
				this.lastUpdatedAt = new Date(this.now()).toISOString();
				await this.persistLocal();
				await this.saveIndex();
			} finally {
				this.working = false;
				this.publish();
			}
			return report;
		});
		this.chain = run.then(() => undefined, () => undefined);
		return run;
	}

	/** The items at the head of the queue that may run together: documents up to the concurrency, or one item of any other kind. */
	private nextBatch(): NovelPendingItem[] {
		const head = this.queue[0];
		if (head.kind !== "document") return [head];
		const configured = this.options.concurrency;
		const limit = Math.max(1, Math.floor((typeof configured === "function" ? configured() : configured) ?? 1));
		const batch: NovelPendingItem[] = [];
		for (const item of this.queue) {
			if (item.kind !== "document" || batch.length >= limit) break;
			batch.push(item);
		}
		return batch;
	}

	/**
	 * Work one batch: documents are prepared in queue order first (record,
	 * position, whether anything changed), then delivered side by side; any
	 * other item runs alone. Returns how each item ended: done (including
	 * failed — the failure is recorded), paused by the connection, or held by
	 * the writer.
	 */
	private async workBatch(batch: readonly NovelPendingItem[], report: ProcessReport): Promise<Map<NovelPendingItem, "done" | "paused" | "held">> {
		const outcomes = new Map<NovelPendingItem, "done" | "paused" | "held">();
		const prepared = new Map<NovelPendingItem, PreparedDocument | null>();
		const placed = new Set<string>();
		const fail = (item: NovelPendingItem, error: unknown) => {
			const path = "path" in item ? item.path : novelPaths.projectFile;
			const reason = error instanceof Error ? error.message : String(error);
			this.failures.set(path, reason);
			report.failures.push({ path, reason });
			outcomes.set(item, "done");
		};
		for (const item of batch) {
			if (item.kind !== "document") continue;
			try {
				const document = await this.prepareDocument(item.path, report);
				prepared.set(item, document);
				if (document) placed.add(document.record.docId);
				else outcomes.set(item, "done");
			} catch (error) {
				fail(item, error);
			}
		}
		await Promise.all(batch.map(async (item) => {
			if (outcomes.has(item)) return;
			try {
				if (item.kind === "document") await this.deliverDocument(prepared.get(item)!, report, placed);
				else await this.process(item, report);
				outcomes.set(item, "done");
			} catch (error) {
				if (error instanceof ExtractionPausedError) outcomes.set(item, "paused");
				else if (error instanceof BuildHeldError) outcomes.set(item, "held");
				else fail(item, error);
			}
		}));
		return outcomes;
	}

	/** Persist the engine database now (the plugin is unloading): stop at the next chunk, then save what was retained. */
	async persist(): Promise<void> {
		this.held = true;
		await this.chain;
		await this.writeBundles();
		await this.saveIndex(true);
	}

	close(): void {
		if (this.resumeTimer !== null) {
			(this.options.clearTimer ?? ((handle) => window.clearTimeout(handle as number)))(this.resumeTimer);
			this.resumeTimer = null;
		}
		this.session?.close();
		this.session = null;
	}

	/**
	 * While the model is unavailable, stop delivering: the queue is kept, the
	 * reason is shown, and one timer works the queue again when the wait is
	 * over. True when the caller should stop now.
	 */
	private pauseWhileUnavailable(): boolean {
		const availability = this.options.availability;
		const wait = availability?.waitMs() ?? 0;
		if (!availability || wait <= 0) return false;
		if (this.resumeTimer === null) {
			const setTimer = this.options.setTimer ?? ((callback, ms) => window.setTimeout(callback, ms));
			this.resumeTimer = setTimer(() => {
				this.resumeTimer = null;
				void this.flush();
			}, wait);
		}
		return true;
	}

	/** Before every model call: an unavailable model interrupts the delivery rather than being asked. */
	private assertAvailable(): void {
		const availability = this.options.availability;
		if (availability && availability.waitMs() > 0) throw new ExtractionPausedError(availability.reason ?? "The AI connection is unavailable.");
	}

	// ---- processing --------------------------------------------------------

	private async process(item: NovelPendingItem, report: ProcessReport): Promise<void> {
		switch (item.kind) {
			case "document": return this.processDocument(item.path, report);
			case "delete": return this.processDelete(item.path, report);
			case "rename": return this.processRename(item.oldPath, item.path, report);
			case "artifact": return this.processBundle(item.path, report, item.changed === true);
			case "rebuild": return this.processRebuild(report);
		}
	}

	private async processDocument(path: string, report: ProcessReport): Promise<void> {
		const prepared = await this.prepareDocument(path, report);
		if (prepared) await this.deliverDocument(prepared, report, new Set([prepared.record.docId]));
	}

	/**
	 * Read and place a document: its record, its position among the others,
	 * and whether there is anything to deliver. Null when there is not. This
	 * is the part that must happen in queue order, because placing one
	 * document can move the positions of others.
	 */
	private async prepareDocument(path: string, report: ProcessReport): Promise<PreparedDocument | null> {
		const role = this.classify(path);
		if (!role) return null;
		let text: string;
		try {
			text = await this.options.reader.read(path);
		} catch {
			// Gone before we got to it: a delete event will follow or already did.
			return null;
		}
		if (role === "manuscript" && hasExplicitArchiveMetadata(text)) {
			// An archived draft is not manuscript; if it was tracked, retire it.
			if (this.isTracked(path)) await this.processDelete(path, report);
			return null;
		}
		const revision = contentRevision(text);
		let record = this.recordByPath(path);
		let movedByContent = false;
		if (!record) {
			if (this.newerSchema.has(documentIdFor(path))) return null;
			const moved = matchRenameByContent(this.documentRecords, revision, role);
			if (moved) {
				report.renamed.push({ from: moved.path, to: path });
				moved.path = path;
				movedByContent = true;
			}
			record = moved ?? this.newRecord(path, role);
		}
		if (this.newerSchema.has(record.docId)) return null;
		const wasDeleted = record.status === "deleted";
		record.status = "active";
		this.missing.delete(record.docId);
		record.pov = role === "manuscript" ? declaredPov(text) : null;
		this.declaredOrdinalCache.set(record.docId, role === "manuscript" ? declaredOrdinal(text) : null);
		const positionsChanged = this.reassignOrdinals();
		if (movedByContent) {
			const existing = this.documents.get(record.docId);
			if (existing) this.updateRecord({ ...existing, path, status: "active", ordinal: record.ordinal, updatedAt: new Date(this.now()).toISOString() });
		}
		const changed = record.revision !== revision;
		if (!changed && !wasDeleted && !positionsChanged.has(record.docId) && this.isLoaded(record)) {
			report.unchanged.push(path);
			return null;
		}
		return { record, text, revision, wasDeleted, positionsChanged };
	}

	/** Deliver a prepared document; documents it moved are re-delivered unchanged so Recanta repositions them, unless this batch already places them. */
	private async deliverDocument(prepared: PreparedDocument, report: ProcessReport, placed: ReadonlySet<string>): Promise<void> {
		const { record, text, revision, wasDeleted, positionsChanged } = prepared;
		await this.retainDocument(record, text, revision, { wasDeleted }, report);
		for (const other of positionsChanged) {
			if (other === record.docId || placed.has(other)) continue;
			const moved = this.records.get(other);
			if (moved && moved.status === "active") this.enqueue({ kind: "document", path: moved.path });
		}
	}

	/**
	 * Deliver a document to Recanta by stable identity. Unchanged text is a
	 * duplicate to Recanta (no evidence, no extraction); text it already saw
	 * from another device's bundle is the same; only genuinely new text costs
	 * a model call. Chunks that no longer exist are retired.
	 */
	private async retainDocument(record: DocumentRecord, text: string, revision: string, flags: { wasDeleted: boolean }, report: ProcessReport): Promise<void> {
		if (!this.book || !this.local) return;
		const previous = this.documents.get(record.docId);
		const chunks = record.role === "manuscript"
			? chunkManuscript(text, this.options.maxChunkChars)
			: [{ index: 0, heading: null, text: stripFrontmatter(text).text, start: 0, end: text.length, revision: contentRevision(stripFrontmatter(text).text) }];
		let version = record.revision === revision && record.version > 0 ? record.version : record.version + 1;
		let replayed = true;
		let failure: string | null = null;
		if (this.session) {
			const adapter = this.session.adapter;
			if (flags.wasDeleted) {
				if (record.role === "manuscript") adapter.restoreChunks(record.docId, previous?.chunks.length ?? 0);
				else adapter.restoreCanon(record.docId);
			}
			let outcomes: DocumentReceipt[] = [];
			for (let attempt = 0; ; attempt += 1) {
				const refusalsBefore = this.options.availability?.refusals ?? 0;
				try {
					this.assertAvailable();
					outcomes = record.role === "manuscript"
						? await this.retainChunks(record, chunks, version)
						: [await adapter.retainCanon({ docId: record.docId, version, text: chunks[0].text })];
				} catch (error) {
					// Another device used this revision number for different text (a concurrent edit).
					// This device's text is the truth here; the next number keeps both histories.
					if (errorCode(error) !== "IDEMPOTENCY_CONFLICT" || attempt >= 8) throw error;
					version += 1;
					continue;
				}
				const settled = await this.settleRuns(outcomes, refusalsBefore);
				failure = settled.failure;
				// A run the engine gave up on for good is only revived by a fresh revision of the same text.
				if (settled.exhausted && attempt < 2) { version += 1; continue; }
				break;
			}
			replayed = outcomes.every((outcome) => outcome.outcome !== "accepted");
			const previousCount = previous?.chunks.length ?? 0;
			if (record.role === "manuscript" && previousCount > chunks.length) adapter.deleteChunks(record.docId, chunks.length, previousCount);
			if (failure === null) this.local.loaded[record.docId] = { version, chunkRevisions: chunks.map((chunk) => chunk.revision) };
			else delete this.local.loaded[record.docId];
			this.dirty = true;
		}
		record.revision = revision;
		record.version = version;
		record.updatedAt = new Date(this.now()).toISOString();
		this.updateRecord({
			schemaVersion: 1,
			format: "wb-novel-source-v1",
			docId: record.docId,
			path: record.path,
			role: record.role,
			status: "active",
			revision,
			version,
			ordinal: record.ordinal,
			pov: record.pov,
			chunks: chunks.map((chunk) => ({ index: chunk.index, revision: chunk.revision, heading: chunk.heading })),
			engine: this.engineIdentity(),
			writer: "",
			updatedAt: record.updatedAt,
		});
		if (failure !== null) throw new Error(failure);
		this.failures.delete(record.path);
		report.processed.push(record.path);
		if (this.session && replayed) report.replayed.push(record.path);
	}

	/**
	 * A run the engine could not finish (the model refused, timed out, or
	 * returned something it could not validate) is reported for the writer's
	 * Retry, and the document stays unloaded so that Retry delivers it again;
	 * that delivery finds the same run and asks the engine to repeat it. A run
	 * that failed in this very pass is not asked again at once: whatever
	 * refused it is still there, and a second identical call only pays twice.
	 * Text another device extracted in the meantime heals it through its
	 * bundle without a model.
	 */
	private async settleRuns(outcomes: readonly DocumentReceipt[], refusalsBefore: number): Promise<{ failure: string | null; exhausted: boolean }> {
		const adapter = this.session?.adapter;
		if (!adapter) return { failure: null, exhausted: false };
		for (const outcome of outcomes) {
			if (outcome.readiness?.memory !== "failed" || !outcome.processingId) continue;
			let run = adapter.processingRun(outcome.processingId);
			// A run that failed while the connection was refusing met that refusal, not a fault of its text:
			// the document stays queued, even when another document's call answered since and cleared the wait.
			if (run?.status === "failed" && (this.options.availability?.refusals ?? 0) > refusalsBefore) {
				throw new ExtractionPausedError(this.options.availability?.reason ?? "The AI connection refused the call.");
			}
			if (run?.status === "failed" && run.failure?.code !== "RETRY_EXHAUSTED" && outcome.outcome !== "accepted") {
				this.assertAvailable();
				run = await adapter.retryProcessing(outcome.processingId);
			}
			if (run?.status === "failed") {
				// A refusal from the connection is not this document's failure: it stays queued for when the model is back.
				this.assertAvailable();
				return { failure: run.failure?.message ?? "The engine could not process this text.", exhausted: run.failure?.code === "RETRY_EXHAUSTED" };
			}
		}
		return { failure: null, exhausted: false };
	}

	private async retainChunks(record: DocumentRecord, chunks: ManuscriptChunk[], version: number) {
		const adapter = this.session!.adapter;
		const outcomes = [];
		try {
			for (const chunk of chunks) {
				if (this.held) throw new BuildHeldError();
				this.assertAvailable();
				this.chunkProgress.set(record.docId, { chunk: chunk.index + 1, chunks: chunks.length });
				this.publish();
				outcomes.push(await adapter.retainManuscriptChunk({
				docId: record.docId,
				chunk: chunk.index,
				version,
				position: { ordinal: record.ordinal ?? 0, chunk: chunk.index },
				text: chunk.text,
					pov: record.pov,
				}));
			}
		} finally {
			this.chunkProgress.delete(record.docId);
		}
		return outcomes;
	}

	private async processDelete(path: string, report: ProcessReport): Promise<void> {
		const record = this.recordByPath(path);
		if (!record || record.status === "deleted") return;
		record.status = "deleted";
		record.ordinal = null;
		record.updatedAt = new Date(this.now()).toISOString();
		this.missing.delete(record.docId);
		const existing = this.documents.get(record.docId);
		if (existing) this.updateRecord({ ...existing, status: "deleted", ordinal: null, updatedAt: record.updatedAt });
		if (this.session) {
			if (record.role === "manuscript") this.session.adapter.deleteChunks(record.docId, 0, existing?.chunks.length ?? 0);
			else this.session.adapter.deleteCanon(record.docId);
			this.dirty = true;
		}
		report.deleted.push(path);
		this.failures.delete(path);
		// Positions after the gap shift; those documents are re-delivered unchanged so Recanta repositions them.
		for (const docId of this.reassignOrdinals()) {
			const moved = this.records.get(docId);
			if (moved?.status === "active") this.enqueue({ kind: "document", path: moved.path });
		}
	}

	private async processRename(oldPath: string, path: string, report: ProcessReport): Promise<void> {
		const record = this.recordByPath(oldPath);
		const role = this.classify(path);
		if (record && role && role === record.role) {
			record.path = path;
			record.updatedAt = new Date(this.now()).toISOString();
			report.renamed.push({ from: oldPath, to: path });
			this.failures.delete(oldPath);
			const existing = this.documents.get(record.docId);
			if (existing) this.updateRecord({ ...existing, path, updatedAt: record.updatedAt });
			// Same content under a new name: nothing to retain unless its order moved.
			for (const docId of this.reassignOrdinals()) {
				const moved = this.records.get(docId);
				if (moved?.status === "active") this.enqueue({ kind: "document", path: moved.path });
			}
			return;
		}
		if (record) await this.processDelete(oldPath, report);
		if (role) await this.processDocument(path, report);
	}

	/**
	 * A managed file changed on disk — sync delivered another device's bundle,
	 * or this device wrote its own. A bundle whose content this device last
	 * wrote or applied is not news. Otherwise its record is adopted when newer
	 * than ours, and its artifacts are handed to Recanta.
	 */
	private async processBundle(path: string, report: ProcessReport, changed: boolean): Promise<void> {
		if (!this.book || !this.local) return;
		if (path === novelPaths.projectFile) {
			const book = await this.options.store.readBook();
			if (book.kind === "loaded" && book.value.bookId === this.book.bookId) this.book = book.value;
			return;
		}
		if (NovelKnowledgeStore.isCorrectionBundlePath(path)) {
			const id = path.split("/").pop()!.slice(0, -".md".length);
			const result = await this.options.store.readCorrection(id);
			if (result.kind === "newer") throw new Error(`Written by a newer Writing Buddy (schema ${result.schemaVersion}).`);
			if (result.kind === "malformed") throw new Error(result.reason);
			if (result.kind === "missing") return;
			const key = `corr:${slug(id)}`;
			const hash = contentHash(await this.options.fs.read(path));
			this.failures.delete(path);
			if (this.local.bundles[key] === hash && !changed) return;
			const current = this.corrections.get(id);
			if (!current || result.value.record.version >= current.version) this.corrections.set(id, result.value.record);
			this.rememberArtifacts(key, result.value.artifacts);
			if (this.session) {
				await this.importArtifacts(result.value.artifacts, report);
				const correction = this.corrections.get(id)!;
				if ((this.local.corrections[id] ?? 0) < correction.version) {
					await this.session.adapter.retainCorrection({ id: correction.id, version: correction.version, text: correction.text });
					this.local.corrections[id] = correction.version;
					this.dirty = true;
					report.processed.push(path);
				}
			}
			if (result.value.tornBlocks === 0) this.local.bundles[key] = hash;
			return;
		}
		const docId = path.split("/").pop()!.slice(0, -".md".length);
		const result = await this.options.store.readSource(docId);
		if (result.kind === "newer") throw new Error(`Written by a newer Writing Buddy (schema ${result.schemaVersion}).`);
		if (result.kind === "malformed") throw new Error(result.reason);
		if (result.kind === "missing") return;
		const hash = contentHash(await this.options.fs.read(path));
		this.failures.delete(path);
		if (this.local.bundles[docId] === hash) {
			report.unchanged.push(path);
			return;
		}
		const arrived = result.value.record;
		const current = this.documents.get(docId);
		// Artifacts are immutable and carry their own checksums: everything in the bundle is taken in
		// regardless of whose record is newer, and a torn block is simply not there yet.
		this.rememberArtifacts(docId, result.value.artifacts);
		if (this.session) await this.importArtifacts(result.value.artifacts, report);
		if (result.value.tornBlocks === 0) this.local.bundles[docId] = hash;
		if (current && (arrived.version < current.version || (arrived.version === current.version && arrived.updatedAt < current.updatedAt))) {
			// Stale record: ours is newer, so our bundle is rewritten and sync converges on it.
			this.dirtyBundles.add(docId);
			report.unchanged.push(path);
			return;
		}
		if (current && arrived.version === current.version && arrived.revision === current.revision && arrived.status === current.status && arrived.path === current.path) {
			this.documents.set(docId, arrived);
			report.unchanged.push(path);
			return;
		}
		this.documents.set(docId, arrived);
		const record = this.records.get(docId);
		const adopted = documentRecordFrom(arrived);
		if (record) Object.assign(record, adopted);
		else this.records.set(docId, adopted);
		this.reassignOrdinals();
		if (arrived.status === "deleted") {
			this.missing.delete(docId);
			if (this.session && this.local.loaded[docId]) {
				if (arrived.role === "manuscript") this.session.adapter.deleteChunks(docId, 0, arrived.chunks.length);
				else this.session.adapter.deleteCanon(docId);
				this.dirty = true;
			}
			report.deleted.push(arrived.path);
			return;
		}
		// The other device processed this text. If it is here, deliver it (a
		// duplicate to Recanta once its artifacts are in); if not, wait for it.
		let text: string | null = null;
		try {
			text = await this.options.reader.read(arrived.path);
		} catch {
			this.missing.add(docId);
		}
		if (text === null) return;
		this.missing.delete(docId);
		const loaded = this.local.loaded[docId];
		if (contentRevision(text) === arrived.revision && loaded && loaded.version === arrived.version) {
			report.unchanged.push(path);
			return;
		}
		this.enqueue({ kind: "document", path: arrived.path });
	}

	/** Hand artifacts to Recanta; a divergent history this device has not seen before triggers a deterministic rebuild. */
	private async importArtifacts(artifacts: readonly PortableArtifact[], report: ProcessReport): Promise<void> {
		if (!this.session || !this.local || artifacts.length === 0) return;
		const imported = this.session.adapter.import(artifacts);
		const applied = imported.applied.evidence + imported.applied.run + imported.applied.fact + imported.applied.lifecycle;
		report.imported += applied;
		if (applied > 0) this.dirty = true;
		const pending = new Set(imported.pending);
		for (const artifact of artifacts) {
			if (pending.has(artifact.name)) this.pendingArtifacts.set(artifact.name, artifact);
			else this.pendingArtifacts.delete(artifact.name);
		}
		this.noteDivergence(imported.issues.filter((issue) => issue.reason === "divergent").map((issue) => issue.name));
	}

	private noteDivergence(names: string[]): void {
		if (!this.local) return;
		const fresh = names.filter((name) => !this.local!.divergent.includes(name));
		if (fresh.length === 0) return;
		this.local.divergent.push(...fresh);
		if (!this.rebuilding) this.enqueue({ kind: "rebuild" });
	}

	private async retryPendingArtifacts(report: ProcessReport): Promise<void> {
		if (this.pendingArtifacts.size === 0) return;
		await this.importArtifacts([...this.pendingArtifacts.values()], report);
	}

	/** Every bundle in the Vault whose content this device has not applied, in one pass (start-up and rebuild). */
	private async takeInBundles(): Promise<number> {
		if (!this.session || !this.local) return 0;
		const report: ProcessReport = { processed: [], unchanged: [], deleted: [], renamed: [], replayed: [], imported: 0, exported: 0, failures: [] };
		for (const docId of this.documents.keys()) {
			const path = NovelKnowledgeStore.sourcePath(docId);
			if (!(await this.options.fs.exists(path))) continue;
			const hash = contentHash(await this.options.fs.read(path));
			if (this.local.bundles[docId] === hash) continue;
			const artifacts = this.bundleArtifacts.get(docId);
			if (artifacts) await this.importArtifacts([...artifacts.entries()].map(([name, text]) => ({ name, text })), report);
			this.local.bundles[docId] = hash;
		}
		for (const correction of this.corrections.values()) {
			const key = `corr:${slug(correction.id)}`;
			const path = NovelKnowledgeStore.correctionPath(correction.id);
			if (!(await this.options.fs.exists(path))) continue;
			const hash = contentHash(await this.options.fs.read(path));
			if (this.local.bundles[key] === hash) continue;
			const artifacts = this.bundleArtifacts.get(key);
			if (artifacts) await this.importArtifacts([...artifacts.entries()].map(([name, text]) => ({ name, text })), report);
			this.local.bundles[key] = hash;
		}
		await this.retryPendingArtifacts(report);
		return report.imported;
	}

	/** New local knowledge since the last export joins the bundles of the documents it concerns. */
	private exportArtifacts(): void {
		if (!this.session || !this.local) return;
		const result = this.session.adapter.exportSince(this.local.exportedVersion);
		this.absorbArtifacts(result.artifacts);
		this.local.exportedVersion = Math.max(this.local.exportedVersion, result.version);
	}

	/** Place artifacts into their bundles' in-memory sets, marking the bundles that gained something. */
	private absorbArtifacts(artifacts: readonly PortableArtifact[]): void {
		if (!this.session) return;
		for (const [key, list] of this.session.adapter.groupByDocument(artifacts)) {
			if (key === null) continue;
			const known = this.bundleArtifacts.get(key) ?? new Map<string, string>();
			let grew = false;
			for (const artifact of list) {
				if (known.has(artifact.name)) continue;
				known.set(artifact.name, artifact.text);
				grew = true;
			}
			this.bundleArtifacts.set(key, known);
			if (grew) this.dirtyBundles.add(key);
		}
	}

	private rememberArtifacts(key: string, artifacts: readonly PortableArtifact[]): void {
		const known = this.bundleArtifacts.get(key) ?? new Map<string, string>();
		for (const artifact of artifacts) if (!known.has(artifact.name)) known.set(artifact.name, artifact.text);
		this.bundleArtifacts.set(key, known);
	}

	/** Write every bundle whose record or artifacts changed; the hash of what was written is what sync will echo back. */
	private async writeBundles(): Promise<number> {
		if (!this.local) return 0;
		let written = 0;
		for (const key of [...this.dirtyBundles]) {
			this.dirtyBundles.delete(key);
			const artifacts = [...(this.bundleArtifacts.get(key) ?? new Map<string, string>()).entries()].map(([name, text]) => ({ name, text }));
			if (key.startsWith("corr:")) {
				const correction = [...this.corrections.values()].find((item) => `corr:${slug(item.id)}` === key);
				if (!correction) continue;
				this.local.bundles[key] = await this.options.store.writeCorrection(correction, artifacts);
			} else {
				const record = this.documents.get(key);
				if (!record) continue;
				this.local.bundles[key] = await this.options.store.writeSource({ ...record, engine: record.engine ?? this.engineIdentity() }, artifacts);
			}
			written += 1;
		}
		return written;
	}

	/**
	 * Throw the local index away and build it again: first from every bundle
	 * in the Vault (no model call), then from any manuscript text no bundle
	 * covers; finally every bundle is rewritten from the engine, which also
	 * repairs a bundle that was corrupted by hand. Deterministic, so two
	 * devices that rebuild from the same files arrive at the same knowledge.
	 */
	private async processRebuild(report: ProcessReport): Promise<void> {
		if (!this.book || !this.local || !this.options.openEngine) return;
		this.rebuilding = true;
		this.publish();
		try {
			const divergent = [...this.local.divergent];
			this.session?.close();
			this.session = null;
			await this.options.store.clearLocalState(this.book.bookId);
			this.local = this.emptyLocal(this.book.bookId);
			this.local.divergent = divergent;
			this.session = await this.options.openEngine(this.book.bookId, null);
			this.recordEngine();
			this.pendingArtifacts.clear();
			report.imported += await this.takeInBundles();
			const active = this.documentRecords
				.filter((record) => record.status === "active")
				.sort((a, b) => (a.role === b.role ? (a.ordinal ?? 0) - (b.ordinal ?? 0) : a.role === "canon" ? -1 : 1));
			for (const record of active) {
				let text: string;
				try {
					text = await this.options.reader.read(record.path);
				} catch {
					this.missing.add(record.docId);
					continue;
				}
				await this.retainDocument(record, text, contentRevision(text), { wasDeleted: false }, report);
			}
			for (const correction of this.corrections.values()) {
				await this.session.adapter.retainCorrection({ id: correction.id, version: correction.version, text: correction.text });
				this.local.corrections[correction.id] = correction.version;
			}
			// Every bundle is regenerated from the engine's complete state.
			this.bundleArtifacts.clear();
			this.absorbArtifacts(this.session.adapter.exportSince(0).artifacts);
			for (const docId of this.documents.keys()) this.dirtyBundles.add(docId);
			for (const correction of this.corrections.values()) this.dirtyBundles.add(`corr:${slug(correction.id)}`);
			this.local.exportedVersion = this.session.adapter.exportSince(0).version;
			this.dirty = true;
		} finally {
			this.rebuilding = false;
		}
	}

	// ---- reconciliation ----------------------------------------------------

	private async loadBundles(): Promise<void> {
		const { bundles, skipped } = await this.options.store.readAllSources();
		for (const bundle of bundles) {
			this.documents.set(bundle.record.docId, bundle.record);
			this.records.set(bundle.record.docId, documentRecordFrom(bundle.record));
			this.rememberArtifacts(bundle.record.docId, bundle.artifacts);
			if (bundle.tornBlocks > 0) this.dirtyBundles.add(bundle.record.docId);
		}
		for (const item of skipped) {
			this.failures.set(NovelKnowledgeStore.sourcePath(item.docId), item.reason);
			if (item.reason.includes("newer")) this.newerSchema.add(item.docId);
		}
		for (const bundle of await this.options.store.listCorrections()) {
			this.corrections.set(bundle.record.id, bundle.record);
			this.rememberArtifacts(`corr:${slug(bundle.record.id)}`, bundle.artifacts);
			if (bundle.tornBlocks > 0) this.dirtyBundles.add(`corr:${slug(bundle.record.id)}`);
		}
	}

	/**
	 * Carry the pre-Markdown layout over, once. First the records: the legacy
	 * JSON project and document records become the manifest and bundles, so
	 * the book can open. Then, with the engine up, the legacy per-row artifacts
	 * are imported, placed into their documents' bundles, read back and
	 * verified against the legacy files; only then are the legacy files
	 * retired. A run that finds nothing legacy does nothing; one that cannot
	 * verify keeps the legacy files for the next try.
	 */
	private async migrateLegacyRecords(): Promise<void> {
		const store = this.options.store;
		if (!(await store.hasLegacyLayout())) return;
		const legacyBook = await store.readLegacyBook();
		if (legacyBook && (await store.readBook()).kind === "missing") await store.writeBook(legacyBook);
		for (const record of await store.readLegacyDocuments()) {
			if ((await store.readSource(record.docId)).kind !== "missing") continue;
			await store.writeSource(record, []);
		}
		for (const correction of await store.readLegacyCorrections()) {
			if ((await store.readCorrection(correction.id)).kind !== "missing") continue;
			await store.writeCorrection(correction, []);
		}
	}

	private async migrateLegacyArtifacts(): Promise<void> {
		const store = this.options.store;
		if (!this.session || !this.local || !(await store.hasLegacyLayout())) return;
		const artifacts = await store.readLegacyArtifacts();
		const report: ProcessReport = { processed: [], unchanged: [], deleted: [], renamed: [], replayed: [], imported: 0, exported: 0, failures: [] };
		await this.importArtifacts(artifacts, report);
		await this.retryPendingArtifacts(report);
		const groups = this.session.adapter.groupByDocument(artifacts);
		const unverified: string[] = [...(groups.get(null) ?? []).map((item) => item.name)];
		for (const [key, list] of groups) {
			if (key === null) continue;
			if (!key.startsWith("corr:") && !this.documents.has(key)) { unverified.push(...list.map((item) => item.name)); continue; }
			if (key.startsWith("corr:") && ![...this.corrections.values()].some((item) => `corr:${slug(item.id)}` === key)) { unverified.push(...list.map((item) => item.name)); continue; }
			this.rememberArtifacts(key, list);
			this.dirtyBundles.add(key);
		}
		const bundles = await this.writeBundles();
		for (const [key, list] of groups) {
			if (key === null) continue;
			const check = key.startsWith("corr:")
				? await store.readCorrection([...this.corrections.values()].find((item) => `corr:${slug(item.id)}` === key)?.id ?? "")
				: await store.readSource(key);
			const present = new Set(check.kind === "loaded" ? check.value.artifacts.map((item) => `${item.name}
${item.text}`) : []);
			for (const artifact of list) if (!present.has(`${artifact.name}
${artifact.text}`) && !unverified.includes(artifact.name)) unverified.push(artifact.name);
		}
		const retired = unverified.length === 0;
		if (retired) await store.removeLegacyLayout();
		this.migration = { bundles, artifacts: artifacts.length, unverified, retired };
	}

	/** Compare the Vault to what the records say, and queue every difference. */
	private async reconcileWithVault(): Promise<void> {
		if (!this.book) return;
		const present = new Set<string>();
		for (const path of this.options.reader.listMarkdownFiles()) {
			const normalized = normaliseVaultPath(path);
			if (!this.classify(normalized)) continue;
			present.add(normalized);
			const record = this.recordByPath(normalized);
			let text: string;
			try {
				text = await this.options.reader.read(normalized);
			} catch {
				continue;
			}
			const revision = contentRevision(text);
			if (!record || record.status === "deleted" || record.revision !== revision || !this.isLoaded(record)) {
				this.enqueue({ kind: "document", path: normalized });
			}
		}
		for (const record of this.records.values()) {
			if (record.status !== "active" || present.has(record.path)) continue;
			// Missing text: a deletion here, or a record that arrived ahead of its manuscript.
			if (this.local?.loaded[record.docId]) this.enqueue({ kind: "delete", path: record.path });
			else this.missing.add(record.docId);
		}
		if (this.session && this.local) {
			for (const correction of this.corrections.values()) {
				if ((this.local.corrections[correction.id] ?? 0) < correction.version) this.enqueue({ kind: "artifact", path: NovelKnowledgeStore.correctionPath(correction.id), changed: true });
			}
		}
	}

	// ---- engine ------------------------------------------------------------

	private async openEngine(): Promise<void> {
		if (this.session || !this.options.openEngine || !this.book || !this.local) return;
		const bytes = await this.options.store.readLocalIndex(this.book.bookId);
		this.session = await this.options.openEngine(this.book.bookId, bytes);
		const info = this.session.adapter.engineInfo();
		const stored = this.local.engine;
		const mismatch = stored !== null && (stored.schemaVersion !== info.schemaVersion || stored.indexVersion !== info.indexVersion || stored.version !== info.engine.version);
		if (this.session.recovered || (bytes !== null && mismatch) || (bytes === null && Object.keys(this.local.loaded).length > 0)) {
			// The stored index is unusable, from another engine, or gone while the state says it was loaded: rebuild it.
			this.enqueue({ kind: "rebuild" });
		}
		this.recordEngine();
	}

	private recordEngine(): void {
		if (!this.session || !this.local) return;
		const info = this.session.adapter.engineInfo();
		this.local.engine = { version: info.engine.version, schemaVersion: info.schemaVersion, indexVersion: info.indexVersion };
	}

	private engineIdentity(): EngineIdentity | null {
		if (!this.session) return this.book?.engine ?? null;
		const info = this.session.adapter.engineInfo();
		return { name: info.engine.name, version: info.engine.version, schemaVersion: info.schemaVersion, artifactFormat: info.artifactFormat };
	}

	private rebuildQueued(): boolean {
		return this.queue.some((item) => item.kind === "rebuild");
	}

	private async saveIndex(force = false): Promise<void> {
		if (!this.session || !this.book || (!this.dirty && !force)) return;
		const bytes = this.session.exportBytes();
		if (bytes) await this.options.store.writeLocalIndex(this.book.bookId, bytes);
		this.dirty = false;
	}

	// ---- helpers -----------------------------------------------------------

	private classify(path: string): DocumentRole | null {
		if (!this.book) return null;
		return classifyPath(normaliseVaultPath(path), this.book);
	}

	private isTracked(path: string): boolean {
		const record = this.recordByPath(path);
		return record !== null && record.status === "active";
	}

	private recordByPath(path: string): DocumentRecord | null {
		const normalized = normaliseVaultPath(path);
		for (const record of this.records.values()) if (record.path === normalized && record.status !== "deleted") return record;
		for (const record of this.records.values()) if (record.path === normalized) return record;
		return null;
	}

	private newRecord(path: string, role: DocumentRole): DocumentRecord {
		let docId = documentIdFor(path);
		// A deleted record can hold the id of a path that is being reused; the
		// new document is new, so it gets a distinct id.
		if (this.records.has(docId) && this.records.get(docId)!.status === "deleted") docId = documentIdFor(`${path}#${this.records.get(docId)!.version + 1}`);
		const record: DocumentRecord = { docId, path, role, revision: null, version: 0, ordinal: null, status: "active", pov: null, updatedAt: new Date(this.now()).toISOString() };
		this.records.set(docId, record);
		return record;
	}

	private isLoaded(record: DocumentRecord): boolean {
		if (!this.session) return true;
		const loaded = this.local?.loaded[record.docId];
		return loaded !== undefined && loaded.version === record.version && record.version > 0;
	}

	/**
	 * A record change is written with its bundle at the end of the flush. A
	 * record that says nothing new (the same revision, version, order and
	 * shape, only a fresh timestamp) leaves the bundle alone, so devices do not
	 * rewrite each other's files back and forth.
	 */
	private updateRecord(artifact: NovelDocumentArtifact): void {
		const current = this.documents.get(artifact.docId);
		const shape = (item: NovelDocumentArtifact) => JSON.stringify([item.path, item.role, item.status, item.revision, item.version, item.ordinal, item.pov, item.chunks]);
		if (current && shape(current) === shape(artifact)) return;
		this.documents.set(artifact.docId, artifact);
		this.dirtyBundles.add(artifact.docId);
	}

	/** Recompute ordinals from declared numbers and natural path order; returns the documents whose position moved. */
	private reassignOrdinals(): Set<string> {
		const declared = new Map<string, number | null>();
		for (const record of this.records.values()) declared.set(record.docId, this.declaredOrdinalCache.get(record.docId) ?? null);
		return new Set(assignOrdinals(this.documentRecords, declared).map((record) => record.docId));
	}
	private readonly declaredOrdinalCache = new Map<string, number | null>();

	private enqueue(item: NovelPendingItem): void {
		const key = JSON.stringify(item);
		if (this.queue.some((queued) => JSON.stringify(queued) === key)) return;
		if (item.kind === "rebuild") {
			// One rebuild supersedes every queued document; it will read them all.
			// The items being worked stay at the head.
			const head = this.queue.slice(0, this.inFlight);
			this.queue.splice(0, this.queue.length, ...head);
		}
		if (item.kind === "artifact") {
			// Another device's knowledge never costs a model call and may make the queued
			// text free to deliver, so it goes ahead of everything that is not being worked.
			const isBundle = (queued: NovelPendingItem) => queued.kind === "artifact";
			const start = this.inFlight;
			let insertAt = this.queue.length;
			for (let index = start; index < this.queue.length; index += 1) if (!isBundle(this.queue[index])) { insertAt = index; break; }
			this.queue.splice(insertAt, 0, item);
			return;
		}
		this.queue.push(item);
	}

	private emptyLocal(bookId: string): NovelLocalState {
		return { schemaVersion: 2, bookId, loaded: {}, corrections: {}, exportedVersion: 0, bundles: {}, divergent: [], engine: null, pending: [], lastError: null, updatedAt: new Date(this.now()).toISOString() };
	}

	private async persistLocal(): Promise<void> {
		if (!this.local) return;
		this.local.updatedAt = new Date(this.now()).toISOString();
		this.local.lastError = this.failures.size ? [...this.failures.values()][0] : null;
		await this.options.store.writeLocalState(this.local);
	}

	private bookIdFor(root: string): string {
		let hash = 0x811c9dc5;
		for (const char of `${root}`) {
			hash ^= char.codePointAt(0) ?? 0;
			hash = Math.imul(hash, 0x01000193) >>> 0;
		}
		return `b${hash.toString(36).padStart(7, "0")}`.slice(0, 12).replace(/[^a-z0-9]/gu, "0");
	}

	private publish(): void {
		this.options.onStatus?.(this.status());
	}
}

/** Which role a Vault path plays in a book's scope, or null when the pass would not read it. */
export function classifyPath(normalized: string, scope: { manuscriptRoot: string; canonPaths: readonly string[] }): DocumentRole | null {
	if (!normalized.toLowerCase().endsWith(".md") || isInternalContextPath(normalized) || NovelKnowledgeStore.isManagedPath(normalized)) return null;
	for (const canon of scope.canonPaths) {
		if (normalized === canon || normalized.startsWith(`${canon}/`)) return "canon";
	}
	const root = scope.manuscriptRoot;
	const inRoot = root === "" || isWithinContextRoot(normalized, root);
	if (!inRoot) return null;
	return isEligibleContextPath(normalized, { root: root === "" ? undefined : root, scope: "full-current-manuscript" }) ? "manuscript" : null;
}
