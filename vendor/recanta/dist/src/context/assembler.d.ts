import type { SqlDatabase } from "../store/driver.ts";
import type { Access } from "../contracts.ts";
import type { SqliteEventStore } from "../store/sqlite.ts";
import { type ContextBudgetPolicy } from "./budget.ts";
import type { ContextResult } from "./contracts.ts";
import type { ContextPlan, ContextPlanResult } from "./plan.ts";
import type { MemoryDiscoveryRequest, MemoryDiscoveryResult, RecallRequest } from "./recall-contracts.ts";
/** One read transaction owns authorized discovery, decisions and mechanical rendering. */
export declare class ContextAssembler {
    #private;
    constructor(db: SqlDatabase, store: SqliteEventStore, policy?: ContextBudgetPolicy, maxCorpusPassages?: number);
    discover(access: Access, request: MemoryDiscoveryRequest): MemoryDiscoveryResult;
    recall(access: Access, request: RecallRequest): ContextResult;
    inspect(access: Access, request: RecallRequest): {
        context: ContextResult;
        plan: ContextPlan;
    };
    plan(access: Access, request: RecallRequest): ContextPlanResult;
}
