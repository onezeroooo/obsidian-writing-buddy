import type { Access, EventStore } from "../contracts.ts";
import type { ExtractionProvider, ProcessingOptions, ProcessingRun } from "./contracts.ts";
import type { SqliteProcessing } from "./sqlite-processing.ts";
export declare class ProcessingCoordinator {
    readonly fingerprint: string;
    readonly provider: ExtractionProvider;
    readonly maxAttempts: number;
    constructor(store: EventStore, runs: SqliteProcessing, options?: ProcessingOptions);
    process(access: Access, processingId: string): Promise<ProcessingRun>;
}
