import { check } from "../errors.js";
import { id, integer, plainObject } from "../validation.js";
import { utf8Length } from "../runtime.js";
export const ESTIMATED_UTF8_TOKEN_COUNTER = {
    fingerprint: "estimated-utf8-div3-v1",
    kind: "estimated",
    count: text => Math.ceil(utf8Length(text) / 3),
};
export function validateBudget(budget, counter) {
    plainObject(budget, ["maxBytes", "maxTokens", "maxEstimatedTokens"]);
    integer(budget.maxBytes, 1, 262144);
    if (budget.maxTokens !== undefined) {
        integer(budget.maxTokens, 1, 131072);
        check(counter.kind === "exact_tokenizer", "INVALID_INPUT", "maxTokens requires an explicitly configured exact token counter.");
    }
    if (budget.maxEstimatedTokens !== undefined) {
        integer(budget.maxEstimatedTokens, 1, 131072);
        check(counter.kind === "estimated", "INVALID_INPUT", "maxEstimatedTokens is available only with estimated token accounting.");
    }
    return budget;
}
export function validateBudgetPolicy(policy = {}) {
    plainObject(policy, ["tokenCounter", "maxOptionalItems"]);
    const supplied = policy.tokenCounter;
    if (supplied) {
        plainObject(supplied, ["fingerprint", "kind", "count"]);
        id(supplied.fingerprint);
        check(supplied.kind === undefined || supplied.kind === "exact_tokenizer", "INVALID_INPUT", "Configured token counter must be exact.");
        check(typeof supplied.count === "function", "INVALID_INPUT", "Invalid token counter.");
    }
    const maxOptionalItems = policy.maxOptionalItems ?? 6;
    integer(maxOptionalItems, 0, 50);
    return { tokenCounter: supplied ? { ...supplied, kind: "exact_tokenizer" } : ESTIMATED_UTF8_TOKEN_COUNTER, maxOptionalItems };
}
export function contextCost(value, counter) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    const tokens = counter.count(text);
    integer(tokens, 0, 1048576);
    return { bytes: utf8Length(text), tokens: { value: tokens, kind: counter.kind, fingerprint: counter.fingerprint } };
}
export function withinBudget(cost, budget) {
    return cost.bytes <= budget.maxBytes
        && (budget.maxTokens === undefined || cost.tokens.value <= budget.maxTokens)
        && (budget.maxEstimatedTokens === undefined || cost.tokens.value <= budget.maxEstimatedTokens);
}
