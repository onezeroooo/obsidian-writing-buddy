/**
 * One effort ladder for every connection.
 *
 * Vendors spell reasoning effort differently — OpenAI takes a word, Anthropic
 * a thinking budget in tokens, Google a `thinkingConfig`, Ollama a `think`
 * flag — and none of them lets a client ask which values a model accepts.
 * The plugin therefore offers the same six words everywhere and each backend
 * translates them into its own request shape. What the writer picks is what
 * the request carries: nothing is downgraded quietly, and an endpoint that
 * refuses a level says so in the ordinary error path.
 *
 * An endpoint that does describe its models (`supported_reasoning_levels` in
 * OpenAI's own catalogue format, or one of the field names in use elsewhere)
 * is believed over this ladder: it knows its models and the plugin does not.
 */

import type { EffortCapability } from "./AIBackend";

export const EFFORT_LADDER = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type EffortLevel = (typeof EFFORT_LADDER)[number];

/** Pre-selected when a model offers a ladder and the endpoint named no default. */
export const DEFAULT_EFFORT: EffortLevel = "medium";

export function isEffortLevel(value: unknown): value is EffortLevel {
	return typeof value === "string" && (EFFORT_LADDER as readonly string[]).includes(value);
}

/** The full ladder as capability entries, labelled by the wire value itself. */
export function fullEffortLadder(): EffortCapability[] {
	return EFFORT_LADDER.map((id) => ({ id }));
}

/**
 * An advertised ladder as capability entries.
 *
 * Known levels come first, in ladder order, so a dropdown reads low to high
 * whatever order the endpoint listed them in; a level the ladder does not
 * know (`none`, `ultra`) is kept after them in the endpoint's order, because
 * the endpoint said the model takes it. The advertised default, when one is
 * named and listed, is flagged so it is pre-selected.
 */
export function advertisedEffortLadder(ids: readonly string[], defaultId?: string | null): EffortCapability[] {
	const unique = [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
	const known = EFFORT_LADDER.filter((level) => unique.includes(level));
	const unknown = unique.filter((id) => !isEffortLevel(id));
	return [...known, ...unknown].map((id) => (id === defaultId ? { id, default: true } : { id }));
}

/**
 * The effort a fresh selection starts with.
 *
 * The endpoint's default when it named one, `medium` when the ladder has it,
 * otherwise the middle of whatever was offered. Undefined only when the
 * model offers no effort at all.
 */
export function defaultEffortFor(efforts: readonly EffortCapability[]): string | undefined {
	if (efforts.length === 0) return undefined;
	const flagged = efforts.find((effort) => effort.default === true);
	if (flagged) return flagged.id;
	if (efforts.some((effort) => effort.id === DEFAULT_EFFORT)) return DEFAULT_EFFORT;
	return efforts[Math.floor((efforts.length - 1) / 2)].id;
}

/**
 * The effort a request carries for a model.
 *
 * A stored value the model still offers is kept. A value it does not offer —
 * from an older install, or from a model change — becomes the default rather
 * than an error the writer has to click through. A model with no ladder
 * carries none.
 */
export function resolveEffort(stored: string | undefined, efforts: readonly EffortCapability[]): string | undefined {
	if (efforts.length === 0) return undefined;
	if (stored && efforts.some((effort) => effort.id === stored)) return stored;
	return defaultEffortFor(efforts);
}

/**
 * Anthropic: extended thinking is sized in tokens, and the answer's own
 * budget must exceed it. Levels a Claude model cannot meet are refused by
 * the API and surface as its error.
 */
const ANTHROPIC_THINKING_BUDGET: Record<EffortLevel, number> = {
	minimal: 1024, low: 2048, medium: 4096, high: 8192, xhigh: 16384, max: 32768,
};
/** Output tokens reserved for the answer itself, on top of the thinking budget. */
export const ANTHROPIC_ANSWER_TOKENS = 8192;

export function anthropicThinking(effort: string | null): { thinking: { type: "enabled"; budget_tokens: number }; max_tokens: number } | { max_tokens: number } {
	if (!isEffortLevel(effort)) return { max_tokens: ANTHROPIC_ANSWER_TOKENS };
	const budget = ANTHROPIC_THINKING_BUDGET[effort];
	return { thinking: { type: "enabled", budget_tokens: budget }, max_tokens: budget + ANTHROPIC_ANSWER_TOKENS };
}

/**
 * Google: `thinkingBudget` in tokens. The top of the ladder stays inside
 * the smallest ceiling among thinking Gemini models (24 576 on Flash) so no
 * level is refused merely for being too large.
 */
const GOOGLE_THINKING_BUDGET: Record<EffortLevel, number> = {
	minimal: 512, low: 1024, medium: 4096, high: 8192, xhigh: 16384, max: 24576,
};

export function googleThinkingConfig(effort: string | null): { thinkingBudget: number } | undefined {
	return isEffortLevel(effort) ? { thinkingBudget: GOOGLE_THINKING_BUDGET[effort] } : undefined;
}

/**
 * Ollama: `think` is a flag, and only gpt-oss reads a level from it. Six
 * words onto three values is the coarsest translation on the ladder; the
 * pairs are adjacent, so a writer moving one step still moves or stays in the
 * direction they chose.
 */
export function ollamaThink(effort: string | null): "low" | "medium" | "high" | undefined {
	if (!isEffortLevel(effort)) return undefined;
	if (effort === "minimal" || effort === "low") return "low";
	if (effort === "medium") return "medium";
	return "high";
}

/** The vendor-prefix-free tail of a model id, as gateways and routers write them. */
export function bareModelId(model: string): string {
	return model.slice(model.lastIndexOf("/") + 1).toLowerCase();
}

/** OpenAI's own reasoning families: GPT-5 and the o-series, behind any vendor prefix. */
export function isOpenAIReasoningFamily(model: string): boolean {
	return /^(gpt-5|o[134])(?![a-z])/.test(bareModelId(model));
}

/** Claude models with extended thinking: 3.7 and every Claude 4 line. Earlier models refuse `thinking`. */
export function isAnthropicThinkingFamily(model: string): boolean {
	const bare = bareModelId(model);
	if (!bare.startsWith("claude")) return false;
	return !/^claude-3-(opus|sonnet|haiku|5)/.test(bare);
}

/** Gemini models with a `thinkingConfig`: 2.5 and later. 1.5 and 2.0 refuse it. */
export function isGoogleThinkingFamily(model: string): boolean {
	return /^gemini-(2\.5|[3-9])/.test(bareModelId(model));
}

/** Ollama models whose `think` takes a level rather than a flag. */
export function isOllamaLevelledThinkingFamily(model: string): boolean {
	return /^gpt-oss/.test(bareModelId(model));
}
