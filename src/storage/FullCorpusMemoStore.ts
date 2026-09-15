/**
 * Durable content-addressed storage for successful Full-analysis memos.
 *
 * Entries are derived project data, but keeping them in the Vault lets an
 * interrupted analysis resume on this or another synced device. The address
 * covers the complete semantic model input; run-local identity and accounting
 * deliberately do not participate.
 */

import type { ContextDocumentPayload, RequestMessage, SkillPayload } from "../backend/AIBackend";
import { hashSkillSource } from "../skills/skillCatalog";
import {
	CACHE_DIR, FULL_CORPUS_CACHE_DIR, fullCorpusMemoPath, legacyFullCorpusMemoPath, type VaultFs,
} from "./paths";

export const FULL_CORPUS_MEMO_SCHEMA_VERSION = 1;
const KEY_PATTERN = /^[0-9a-f]{64}$/u;

export type FullCorpusMemoStage = "leaf" | "reduce";
export type FullCorpusCacheKeyStage = "run" | FullCorpusMemoStage;

export interface FullCorpusMemoRouting {
	connectionId: string | null;
	provider: string | null;
	model: string | null;
	effort: string | null;
}

/** Every value that may change a run or one of its memo-generation calls. */
export interface FullCorpusCacheKeyInput {
	stage: FullCorpusCacheKeyStage;
	routing: Readonly<FullCorpusMemoRouting>;
	messages: readonly Readonly<RequestMessage>[];
	/** The already-composed product/project/skill instruction payload. */
	instructions: Readonly<SkillPayload> | null;
	documents: readonly Readonly<ContextDocumentPayload>[];
}

/** Run inputs may be addressed but only intermediate memo stages are stored. */
export type FullCorpusMemoKeyInput = Omit<FullCorpusCacheKeyInput, "stage"> & {
	stage: FullCorpusMemoStage;
};

export interface FullCorpusMemoRecord {
	schemaVersion: typeof FULL_CORPUS_MEMO_SCHEMA_VERSION;
	key: string;
	stage: FullCorpusMemoStage;
	/** Successful text after the controller's citation allow-list sanitation. */
	text: string;
}

/** Structural seam used by the controller and by alternate test stores. */
export interface FullCorpusMemoCache {
	keyFor(input: Readonly<FullCorpusCacheKeyInput>): string;
	get(input: Readonly<FullCorpusMemoKeyInput>): Promise<Readonly<FullCorpusMemoRecord> | null>;
	put(input: Readonly<FullCorpusMemoKeyInput>, text: string): Promise<void>;
}

/**
 * How many memo files the cache may hold.
 *
 * A single Full run over a 1.25M-character manuscript writes about 65 of
 * them, so this is roughly fifteen runs' worth of resumable work — far more
 * than `Continue` ever reaches back for, and bounded where the folder
 * previously was not. Eviction costs at most a recomputation.
 */
export const FULL_CORPUS_MEMO_LIMIT = 1_000;

/** Writes between directory listings. One Full run is dozens of memos. */
const SWEEP_INTERVAL_WRITES = 25;

export class FullCorpusMemoStore implements FullCorpusMemoCache {
	private readonly pendingWrites = new Map<string, Promise<void>>();
	private writesSinceSweep = 0;

	constructor(private readonly fs: VaultFs) {}

	keyFor(input: Readonly<FullCorpusCacheKeyInput>): string {
		return fullCorpusCacheKey(input);
	}

	async get(input: Readonly<FullCorpusMemoKeyInput>): Promise<Readonly<FullCorpusMemoRecord> | null> {
		const key = this.keyFor(input);
		const path = fullCorpusMemoPath(key);
		try {
			if (await this.fs.exists(path)) {
				return parseRecord(await this.fs.read(path), key, input.stage);
			}
			// The cache moved out of the synced project root. An entry written by
			// an earlier build is still valid work: read it where it used to live
			// rather than paying to recompute it. Migration moves the files; this
			// covers a run that starts before migration has finished.
			const legacy = legacyFullCorpusMemoPath(key);
			if (!(await this.fs.exists(legacy))) return null;
			return parseRecord(await this.fs.read(legacy), key, input.stage);
		} catch {
			// A bad cache file, unavailable sync placeholder, or transient read must
			// never prevent the controller from recomputing the memo.
			return null;
		}
	}

	async put(input: Readonly<FullCorpusMemoKeyInput>, text: string): Promise<void> {
		if (!text.trim()) throw new Error("Full-corpus memo text must not be blank");
		const key = this.keyFor(input);
		const previous = this.pendingWrites.get(key) ?? Promise.resolve();
		const write = previous.catch(() => undefined).then(() => this.putAtKey(input.stage, key, text));
		this.pendingWrites.set(key, write);
		try {
			await write;
		} finally {
			if (this.pendingWrites.get(key) === write) this.pendingWrites.delete(key);
		}
	}

	private async putAtKey(stage: FullCorpusMemoStage, key: string, text: string): Promise<void> {
		const record: FullCorpusMemoRecord = {
			schemaVersion: FULL_CORPUS_MEMO_SCHEMA_VERSION,
			key,
			stage,
			text,
		};
		const serialized = `${JSON.stringify(record, null, "\t")}\n`;
		const path = fullCorpusMemoPath(key);

		await this.ensureDirectory();
		if (!(await this.shouldWrite(path, serialized, key, stage))) return;
		try {
			await this.fs.write(path, serialized);
		} catch (error) {
			// A cache directory may have been removed after the first check. Match
			// project-store writes by rebuilding once, then re-check the address so
			// the retry cannot overwrite a concurrent successful writer.
			await this.ensureDirectory();
			if (!(await this.shouldWrite(path, serialized, key, stage))) return;
			try {
				await this.fs.write(path, serialized);
			} catch {
				throw error;
			}
		}
		await this.sweepIfDue();
	}

	/**
	 * Keep the folder bounded, without listing it on every single write.
	 *
	 * A run writes memos in bursts of dozens, and each sweep costs a directory
	 * listing. Checking once per batch keeps the folder within a small multiple
	 * of the limit while leaving the hot path untouched.
	 */
	private async sweepIfDue(): Promise<void> {
		this.writesSinceSweep += 1;
		if (this.writesSinceSweep < SWEEP_INTERVAL_WRITES) return;
		this.writesSinceSweep = 0;
		try {
			await this.prune();
		} catch {
			// Housekeeping. A cache that cannot be pruned is still a usable cache,
			// and a failure here must never surface as an analysis failure.
		}
	}

	/**
	 * Drop the oldest entries once the folder exceeds its limit.
	 *
	 * Entries are content-addressed and immutable, so their names carry no
	 * order. `stat` supplies modification time where the adapter offers it;
	 * without it, eviction falls back to the listing's own order, which is
	 * arbitrary but still bounded — and every eviction costs a recomputation
	 * at worst, never a correctness problem.
	 */
	async prune(limit: number = FULL_CORPUS_MEMO_LIMIT): Promise<number> {
		if (!(await this.fs.exists(FULL_CORPUS_CACHE_DIR))) return 0;
		const listed = await this.fs.list(FULL_CORPUS_CACHE_DIR);
		const files = listed.files.filter((path) => path.endsWith(".json"));
		if (files.length <= limit) return 0;

		const dated = await Promise.all(files.map(async (path) => ({
			path,
			modifiedAt: (await this.modifiedAt(path)) ?? Number.MAX_SAFE_INTEGER,
		})));
		dated.sort((left, right) => left.modifiedAt - right.modifiedAt);

		let removed = 0;
		for (const entry of dated.slice(0, files.length - limit)) {
			try {
				await this.fs.remove(entry.path);
				removed += 1;
			} catch {
				// Another device or a concurrent run may have removed it already.
			}
		}
		return removed;
	}

	private async modifiedAt(path: string): Promise<number | null> {
		if (!this.fs.stat) return null;
		try {
			return (await this.fs.stat(path))?.mtime ?? null;
		} catch {
			return null;
		}
	}

	private async shouldWrite(
		path: string,
		serialized: string,
		key: string,
		stage: FullCorpusMemoStage,
	): Promise<boolean> {
		if (!(await this.fs.exists(path))) return true;
		const existing = await this.fs.read(path);
		if (existing === serialized) return false;
		// A valid content-addressed entry is immutable. A later nondeterministic
		// model result must not silently replace the first successful value.
		if (parseRecord(existing, key, stage)) return false;
		// Invalid bytes are derived cache data and are safe to repair after the
		// controller recomputes a successful memo.
		return true;
	}

	private async ensureDirectory(): Promise<void> {
		await this.ensureOneDirectory(CACHE_DIR);
		await this.ensureOneDirectory(FULL_CORPUS_CACHE_DIR);
	}

	private async ensureOneDirectory(path: string): Promise<void> {
		if (await this.fs.exists(path)) return;
		try {
			await this.fs.mkdir(path);
		} catch (error) {
			// Another concurrent memo may have created it between exists/mkdir.
			if (!(await this.fs.exists(path))) throw error;
		}
	}
}

/** Deterministic opaque address for a whole run or one persisted memo call. */
export function fullCorpusCacheKey(input: Readonly<FullCorpusCacheKeyInput>): string {
	return hashSkillSource(canonicalInput(input));
}

function canonicalInput(input: Readonly<FullCorpusCacheKeyInput>): string {
	if (input.stage !== "run" && input.stage !== "leaf" && input.stage !== "reduce") {
		throw new Error("Invalid full-corpus cache-key stage");
	}
	return JSON.stringify({
		schemaVersion: FULL_CORPUS_MEMO_SCHEMA_VERSION,
		stage: input.stage,
		routing: {
			connectionId: nullableString(input.routing.connectionId, "connectionId"),
			provider: nullableString(input.routing.provider, "provider"),
			model: nullableString(input.routing.model, "model"),
			effort: nullableString(input.routing.effort, "effort"),
		},
		messages: input.messages.map((message) => ({
			role: message.role,
			content: requiredString(message.content, "message content"),
		})),
		instructions: input.instructions === null ? null : {
			id: requiredString(input.instructions.id, "instruction id"),
			name: requiredString(input.instructions.name, "instruction name"),
			action: input.instructions.action,
			instructions: requiredString(input.instructions.instructions, "instructions"),
		},
		documents: input.documents.map((document) => ({
			path: requiredString(document.path, "document path"),
			text: requiredString(document.text, "document text"),
		})),
	});
}

function parseRecord(
	raw: string,
	expectedKey: string,
	expectedStage: FullCorpusMemoStage,
): Readonly<FullCorpusMemoRecord> | null {
	try {
		const value: unknown = JSON.parse(raw);
		if (!isPlainObject(value) || value.schemaVersion !== FULL_CORPUS_MEMO_SCHEMA_VERSION ||
			typeof value.key !== "string" || !KEY_PATTERN.test(value.key) || value.key !== expectedKey ||
			value.stage !== expectedStage || typeof value.text !== "string" || !value.text.trim()) {
			return null;
		}
		return Object.freeze({
			schemaVersion: FULL_CORPUS_MEMO_SCHEMA_VERSION,
			key: value.key,
			stage: expectedStage,
			text: value.text,
		});
	} catch {
		return null;
	}
}

function nullableString(value: string | null, label: string): string | null {
	return value === null ? null : requiredString(value, label);
}

function requiredString(value: string, label: string): string {
	if (typeof value !== "string") throw new Error(`Invalid ${label}`);
	return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
