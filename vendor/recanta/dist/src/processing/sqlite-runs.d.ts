import type { SqlDatabase } from "../store/driver.ts";
import type { Access, Evidence, EventStore } from "../contracts.ts";
import type { ExtractionOutput, ProcessingRun, ProviderUsage, SourceMetadata } from "./contracts.ts";
type Transaction = <T>(mode: "IMMEDIATE" | "DEFERRED", action: () => T) => T;
/** Durable processing request, lease, usage, output and terminal-state owner. */
export declare class SqliteProcessingRuns {
    constructor(db: SqlDatabase, store: EventStore, transaction: Transaction);
    save(run: ProcessingRun): void;
    /** A state change is a namespace commit; the run row records that version so it exports incrementally. */
    invalidate(run: ProcessingRun): void;
    get(access: Access, processingId: string): ProcessingRun;
    request(access: Access, evidence: Evidence, metadata: SourceMetadata, fingerprint: string, provider: string, maxAttempts: number): ProcessingRun;
    owned(access: Access, processingId: string, token: string): ProcessingRun;
    start(access: Access, processingId: string, fingerprint: string, timeoutMs: number): ProcessingRun;
    recordUsage(access: Access, processingId: string, token: string, usage: ProviderUsage): void;
    saveOutput(access: Access, processingId: string, token: string, output: ExtractionOutput): void;
    fail(access: Access, processingId: string, token: string, failure: ProcessingRun["failure"]): ProcessingRun;
}
export {};
