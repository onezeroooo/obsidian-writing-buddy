import { type ContextBudget, type TokenCounter } from "./budget.ts";
import type { ContextPlanResult } from "./plan.ts";
import type { ContextResult } from "./contracts.ts";
/** Mechanical rendering from selected plan items; no selection decisions occur here. */
export declare function renderContextPlan(result: ContextPlanResult, budget: ContextBudget, counter: TokenCounter): ContextResult;
