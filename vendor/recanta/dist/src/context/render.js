import { check } from "../errors.js";
import { contextCost, withinBudget } from "./budget.js";
/** Mechanical rendering from selected plan items; no selection decisions occur here. */
export function renderContextPlan(result, budget, counter) {
    const plan = result.plan;
    const body = {
        ...plan.body,
        facts: plan.facts.map(item => item.state),
        unresolved: plan.unresolved.filter(item => item.selected).map(item => ({ processingId: item.processingId, decision: item.decision })),
        sources: plan.candidates.filter(item => item.selected && item.section === "relevant_evidence" && !item.required).map(item => ({ citation: item.citation, scopeId: item.scopeId, text: item.text, score: item.score, factLinks: item.factLinks })),
        contextualEvidence: plan.candidates.filter(item => item.selected && item.section === "episode_context").map(item => ({ relation: "episode_neighbor", anchorEvidenceId: item.anchorEvidenceId, citation: item.citation, text: item.text })),
    };
    const text = JSON.stringify(body);
    const cost = contextCost(text, counter);
    check(withinBudget(cost, budget), "INSUFFICIENT_BUDGET", "Planned required context exceeds the configured byte or token budget.");
    plan.budget.used = cost;
    return { text, bytes: cost.bytes, snapshot: result.snapshot };
}
