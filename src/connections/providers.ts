/**
 * The provider catalog: what a writer picks when adding an AI connection.
 *
 * A provider is a product identity — "DeepSeek", "OpenRouter", "Ollama" — not a
 * transport. Most entries are presets over the shared OpenAI-compatible adapter
 * and differ only in name, base URL and how models are discovered. The adapter
 * names below are internal and never shown to the writer.
 *
 * The shape leaves room for what is not here yet: authentication methods other
 * than an API key, and model metadata from an external catalogue. Neither is
 * implemented; the fields exist so adding them does not reshape connections.
 */

import type { AIConnection, DirectAPIProvider } from "./types";
import { DEFAULT_OLLAMA_BASE_URL } from "./types";

export type ProviderAdapter = "openai" | "anthropic" | "google" | "openai-compatible" | "ollama";
export type ProviderCategory = "popular" | "more" | "advanced";
/** `api-key` and `none` are supported today; the rest are reserved for future sign-in flows. */
export type ProviderAuthMethod = "api-key" | "none" | "oauth" | "device-code" | "account-login";
export type ModelDiscovery = "openai-compatible" | "anthropic" | "google" | "ollama" | "preset";

export interface ProviderDefinition {
	id: string;
	name: string;
	category: ProviderCategory;
	adapter: ProviderAdapter;
	/** Empty for adapters that know their own endpoint (OpenAI, Anthropic, Google). */
	defaultBaseUrl: string;
	/** True only where the endpoint is the writer's to choose. */
	baseUrlEditable: boolean;
	authMethods: ProviderAuthMethod[];
	modelDiscovery: ModelDiscovery;
	/** Fallback model ids for a provider whose API lists none. Never merged with another provider's. */
	models?: string[];
}

const compatible = (id: string, name: string, category: ProviderCategory, defaultBaseUrl: string, extra: Partial<ProviderDefinition> = {}): ProviderDefinition => ({
	id, name, category, adapter: "openai-compatible", defaultBaseUrl, baseUrlEditable: false, authMethods: ["api-key"], modelDiscovery: "openai-compatible", ...extra,
});

export const PROVIDERS: readonly ProviderDefinition[] = [
	{ id: "openai", name: "OpenAI", category: "popular", adapter: "openai", defaultBaseUrl: "", baseUrlEditable: false, authMethods: ["api-key"], modelDiscovery: "openai-compatible" },
	{ id: "anthropic", name: "Anthropic", category: "popular", adapter: "anthropic", defaultBaseUrl: "", baseUrlEditable: false, authMethods: ["api-key"], modelDiscovery: "anthropic" },
	{ id: "google", name: "Google", category: "popular", adapter: "google", defaultBaseUrl: "", baseUrlEditable: false, authMethods: ["api-key"], modelDiscovery: "google" },
	compatible("deepseek", "DeepSeek", "popular", "https://api.deepseek.com/v1"),
	compatible("openrouter", "OpenRouter", "popular", "https://openrouter.ai/api/v1"),
	compatible("mistral", "Mistral", "more", "https://api.mistral.ai/v1"),
	compatible("groq", "Groq", "more", "https://api.groq.com/openai/v1"),
	compatible("cerebras", "Cerebras", "more", "https://api.cerebras.ai/v1"),
	compatible("together", "Together AI", "more", "https://api.together.xyz/v1"),
	compatible("fireworks", "Fireworks AI", "more", "https://api.fireworks.ai/inference/v1"),
	// Perplexity's API offers no model listing; the writer picks from the documented names.
	compatible("perplexity", "Perplexity", "more", "https://api.perplexity.ai", { modelDiscovery: "preset", models: ["sonar", "sonar-pro", "sonar-reasoning", "sonar-reasoning-pro"] }),
	compatible("huggingface", "Hugging Face", "more", "https://router.huggingface.co/v1"),
	compatible("siliconflow", "SiliconFlow", "more", "https://api.siliconflow.cn/v1"),
	{ id: "ollama", name: "Ollama", category: "advanced", adapter: "ollama", defaultBaseUrl: DEFAULT_OLLAMA_BASE_URL, baseUrlEditable: true, authMethods: ["none"], modelDiscovery: "ollama" },
	compatible("openai-compatible", "Custom OpenAI-compatible", "advanced", "", { baseUrlEditable: true, authMethods: ["api-key", "none"] }),
];

export const CATEGORY_ORDER: readonly ProviderCategory[] = ["popular", "more", "advanced"];

export function providerById(id: string | undefined): ProviderDefinition | undefined {
	return PROVIDERS.find((provider) => provider.id === id);
}

/** Case-insensitive match on name or id; an empty query returns everything. */
export function searchProviders(query: string): ProviderDefinition[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return [...PROVIDERS];
	return PROVIDERS.filter((provider) => provider.name.toLowerCase().includes(needle) || provider.id.includes(needle));
}

/**
 * The provider a stored connection belongs to. Connections written before the
 * catalogue carry no providerId; their adapter fields say which product they are.
 */
export function providerOf(connection: AIConnection): ProviderDefinition {
	const declared = providerById(connection.providerId);
	if (declared && adapterMatches(declared, connection)) return declared;
	switch (connection.type) {
		case "direct-api": return providerById(connection.config.provider)!;
		case "local": return providerById(connection.config.engine === "ollama" ? "ollama" : "openai-compatible")!;
	}
}

function adapterMatches(provider: ProviderDefinition, connection: AIConnection): boolean {
	if (connection.type === "direct-api") return provider.adapter === connection.config.provider;
	return provider.adapter === (connection.config.engine === "ollama" ? "ollama" : "openai-compatible");
}

/** A blank connection for a catalogue provider, ready for the setup form. */
export function newConnectionFor(provider: ProviderDefinition, id: string): AIConnection {
	if (provider.adapter === "ollama") {
		return { id, name: provider.name, providerId: provider.id, type: "local", enabled: true, config: { engine: "ollama", baseUrl: provider.defaultBaseUrl, apiKey: "" } };
	}
	const adapter: DirectAPIProvider = provider.adapter;
	return { id, name: provider.name, providerId: provider.id, type: "direct-api", enabled: true, config: { provider: adapter, apiKey: "", baseUrl: provider.defaultBaseUrl, modelIds: [] } };
}

export const requiresApiKey = (provider: ProviderDefinition) => provider.authMethods.includes("api-key") && !provider.authMethods.includes("none");
export const acceptsApiKey = (provider: ProviderDefinition) => provider.authMethods.includes("api-key");
