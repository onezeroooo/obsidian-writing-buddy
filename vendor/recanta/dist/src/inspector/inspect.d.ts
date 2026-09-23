import type { SqlDatabase } from "../store/driver.ts";
import type { Access } from "../contracts.ts";
import type { RecallRequest } from "../context/recall-contracts.ts";
import type { SqliteRecanta } from "../recanta.ts";
import type { EvidenceInspection, Inspection } from "./contracts.ts";
import type { ContextPlan } from "../context/plan.ts";
import type { ContextResult } from "../context/contracts.ts";
/** Caller provides the read transaction; inspection repeats all normal access checks. */
export declare class MemoryInspector {
    constructor(db: SqlDatabase, store: SqliteRecanta);
    context(access: Access, request: RecallRequest, context: ContextResult, plan: ContextPlan): Inspection;
    evidence(access: Access, evidenceId: string): EvidenceInspection;
}
