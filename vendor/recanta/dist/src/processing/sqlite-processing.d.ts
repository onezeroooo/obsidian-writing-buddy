import type { SqlDatabase } from "../store/driver.ts";
import type { Access, EventStore } from "../contracts.ts";
import type { Candidate, ProcessingPlan, ProcessingRun, RetainReceipt } from "./contracts.ts";
import { SqliteProcessingRuns } from "./sqlite-runs.ts";
type Transaction = <T>(mode: "IMMEDIATE" | "DEFERRED", action: () => T) => T;
export declare class SqliteProcessing {
    constructor(db: SqlDatabase, store: EventStore, transaction: Transaction);
    get(...args: Parameters<SqliteProcessingRuns["get"]>): ProcessingRun;
    request(...args: Parameters<SqliteProcessingRuns["request"]>): ProcessingRun;
    start(...args: Parameters<SqliteProcessingRuns["start"]>): ProcessingRun;
    recordUsage(...args: Parameters<SqliteProcessingRuns["recordUsage"]>): void;
    saveOutput(...args: Parameters<SqliteProcessingRuns["saveOutput"]>): void;
    fail(...args: Parameters<SqliteProcessingRuns["fail"]>): ProcessingRun;
    plan(access: Access, processingId: string, token: string, candidates: Candidate[], minimumConfidence: number): ProcessingPlan;
    publish(access: Access, plan: ProcessingPlan): ProcessingRun;
    receipt(receipt: Omit<RetainReceipt, "processingId" | "readiness">, run: ProcessingRun): RetainReceipt;
}
export {};
