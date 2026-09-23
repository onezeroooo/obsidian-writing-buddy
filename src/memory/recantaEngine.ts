/**
 * Where the memory engine comes from.
 *
 * Recanta is a host-neutral kernel: it needs a synchronous SQLite driver and
 * nothing else. Inside Obsidian — desktop renderer or mobile WebView alike —
 * that driver is SQLite compiled to WebAssembly (sql.js), whose whole database
 * lives in memory and is persisted by the host as bytes. Writing Buddy keeps
 * those bytes in the disposable cache; they are a local index, never the
 * knowledge itself (see `NovelKnowledgeStore`).
 *
 * This module is the only place that constructs an engine. Everything above
 * it talks to the engine through the host contract (`retainDocument`,
 * `recallContext`, portable artifacts), typed as the structural subset the
 * adapter needs so a test can hand in the same engine over any driver.
 */

import { SqliteRecanta, type ExtractionProvider, type Vocabulary } from "recanta-dev";
import { type SqlJsDriver, sqlJsDriver } from "recanta-dev/sqljs";
import initSqlJs from "sql.js/dist/sql-wasm-browser.js";
import { EXTRACTION_OUTPUT_TOKENS, EXTRACTION_TIMEOUT_MS } from "./backendExtraction";

/** The engine methods Writing Buddy relies on. `SqliteRecanta` satisfies this. */
export type NovelMemoryEngine = Pick<SqliteRecanta,
	| "retainDocument" | "documentState" | "deleteDocument" | "restoreDocument"
	| "recallContext" | "evidence" | "processingStatus" | "retryProcessing" | "healthState"
	| "exportArtifacts" | "importArtifacts" | "engineInfo" | "rebuildLocalState" | "close">;

export interface EngineHandle {
	engine: NovelMemoryEngine;
	/** The database bytes to persist; null when the engine has no exportable driver. */
	exportBytes(): Uint8Array | null;
	close(): void;
}

export interface EngineOptions {
	provider: ExtractionProvider;
	vocabulary?: Vocabulary;
	/** Previously persisted database bytes; a fresh database when absent or unreadable. */
	bytes?: Uint8Array | null;
	maxAttempts?: number;
	timeoutMs?: number;
	/** The output tokens one run may spend; Recanta refuses an answer above it, so the provider is told the same number. */
	maxOutputTokens?: number;
}

/** Builds an engine; the plugin's default opens SQLite-WASM, tests may supply another. */
export type EngineFactory = (options: EngineOptions) => Promise<EngineHandle>;

let runtime: Promise<Awaited<ReturnType<typeof initSqlJs>>> | null = null;

/** sql.js is initialized once per process; the WebAssembly module is shared by every book. */
function sqlJs(wasm: () => Uint8Array): Promise<Awaited<ReturnType<typeof initSqlJs>>> {
	runtime ??= initSqlJs({ wasmBinary: wasm() });
	return runtime;
}

/**
 * Open an engine over SQLite-WASM. When `bytes` cannot be opened, or the
 * kernel refuses the stored schema, the caller gets a fresh empty database
 * and `recovered: true` on the handle so it can rebuild from artifacts.
 */
export function sqlJsEngineFactory(wasm: () => Uint8Array): EngineFactory {
	return async (options) => {
		const SQL = await sqlJs(wasm);
		const open = (data: Uint8Array | null): { engine: SqliteRecanta; driver: SqlJsDriver } => {
			const database = new SQL.Database(data ?? undefined);
			const driver = sqlJsDriver(database);
			try {
				const engine = new SqliteRecanta(driver, { provider: options.provider, ...(options.vocabulary ? { vocabulary: options.vocabulary } : {}), maxAttempts: options.maxAttempts ?? 3, timeoutMs: options.timeoutMs ?? EXTRACTION_TIMEOUT_MS, maxOutputTokens: options.maxOutputTokens ?? EXTRACTION_OUTPUT_TOKENS });
				return { engine, driver };
			} catch (error) {
				driver.close();
				throw error;
			}
		};
		let opened: { engine: SqliteRecanta; driver: SqlJsDriver };
		let recovered = false;
		try {
			opened = open(options.bytes ?? null);
		} catch {
			// An unreadable or incompatible local database is a cache miss, not data loss.
			opened = open(null);
			recovered = options.bytes != null;
		}
		const { engine, driver } = opened;
		return { engine, exportBytes: () => driver.export(), close: () => engine.close(), recovered } as EngineHandle & { recovered: boolean };
	};
}
