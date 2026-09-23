export interface TokenCounter {
    readonly fingerprint: string;
    readonly kind: "exact_tokenizer" | "estimated";
    count(text: string): number;
}
export interface ContextBudget {
    maxBytes: number;
    /** Requires an explicitly injected exact tokenizer. */
    maxTokens?: number;
    /** Explicit heuristic boundary when no exact tokenizer is available. */
    maxEstimatedTokens?: number;
}
export interface TokenAccounting {
    value: number;
    kind: TokenCounter["kind"];
    fingerprint: string;
}
export interface ContextCost {
    bytes: number;
    tokens: TokenAccounting;
}
export interface ContextBudgetPolicy {
    /** Optional exact, model-specific implementation supplied by the trusted host. */
    tokenCounter?: Omit<TokenCounter, "kind"> & {
        readonly kind?: "exact_tokenizer";
    };
    /** Stop after this many optional items even when more capacity is available. */
    maxOptionalItems?: number;
}
export declare const ESTIMATED_UTF8_TOKEN_COUNTER: TokenCounter;
export declare function validateBudget(budget: ContextBudget, counter: TokenCounter): ContextBudget;
export declare function validateBudgetPolicy(policy?: ContextBudgetPolicy): {
    tokenCounter: TokenCounter;
    maxOptionalItems: number;
};
export declare function contextCost(value: unknown, counter: TokenCounter): ContextCost;
export declare function withinBudget(cost: ContextCost, budget: ContextBudget): boolean;
