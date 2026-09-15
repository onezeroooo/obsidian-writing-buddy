import type { Capabilities } from "../backend/AIBackend";

/** `remote-runtime` is a retired type: it may still appear in stored conversations, never in a live connection. */
export type AIConnectionType = "remote-runtime" | "direct-api" | "local";
export type DirectAPIProvider = "openai" | "anthropic" | "google" | "openai-compatible";
/**
 * The local engine identifies the wire protocol, not a particular model file
 * or server implementation. llama.cpp is exposed through OpenAI-compatible.
 */
export type LocalEngine = "ollama" | "openai-compatible";

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const DEFAULT_LOCAL_OPENAI_BASE_URL = "http://127.0.0.1:8793/v1";

interface ConnectionBase {
	id: string;
	name: string;
	/** The catalogue provider this connection was created for. Absent on connections from before the catalogue. */
	providerId?: string;
	type: AIConnectionType;
	enabled: boolean;
}

export interface DirectAPIConnection extends ConnectionBase {
	type: "direct-api";
	config: {
		provider: DirectAPIProvider;
		apiKey: string;
		baseUrl: string;
		/** Optional allow-list. Empty means discover from the provider. */
		modelIds: string[];
	};
}

export interface LocalConnection extends ConnectionBase {
	type: "local";
	config: {
		engine: LocalEngine;
		baseUrl: string;
		/**
		 * Optional. A local server that runs unauthenticated leaves this empty;
		 * one started with a key (llama.cpp `--api-key`, which authenticates
		 * every caller including loopback ones) needs it here.
		 */
		apiKey: string;
	};
}

export type AIConnection = DirectAPIConnection | LocalConnection;

/** Safe to persist in a synced conversation. Contains no endpoint or secret. */
export interface ConnectionSnapshot {
	id: string;
	name: string;
	type: AIConnectionType;
	detail?: string;
}

export type ConnectionHealthKind =
	| "unknown"
	| "checking"
	| "connected"
	| "offline"
	| "auth-error"
	| "unavailable"
	| "disabled";

export interface ConnectionHealth {
	kind: ConnectionHealthKind;
	detail?: string;
	lastChecked?: string;
}

export interface ConnectionRecord {
	connection: AIConnection;
	health: ConnectionHealth;
	capabilities: Capabilities | null;
}

export function connectionSnapshot(connection: AIConnection): ConnectionSnapshot {
	return {
		id: connection.id,
		name: connection.name,
		type: connection.type,
		detail: connectionSummary(connection),
	};
}

/**
 * The provider a connection was made for, as secondary detail beside the
 * connection's own name. The name the writer gave the connection ("Tidewire")
 * is always the primary label; this is the line underneath it. Transport
 * names never reach the interface. Connections from before the provider
 * catalogue are read back through their adapter fields.
 */
export function connectionProviderLabel(connection: AIConnection): string {
	switch (connection.type) {
		case "direct-api": return PROVIDER_NAMES[connection.providerId ?? ""] ?? directProviderLabel(connection.config.provider);
		case "local": return connection.config.engine === "ollama" ? "Ollama" : CUSTOM_COMPATIBLE_LABEL;
	}
}

/** The catalogue name of the custom OpenAI-compatible entry; providers.ts must not be imported here. */
const CUSTOM_COMPATIBLE_LABEL = "Custom OpenAI-compatible";

/** The provider, plus the model list when the writer pinned one. */
export function connectionSummary(connection: AIConnection): string {
	const provider = connectionProviderLabel(connection);
	if (connection.type === "direct-api" && connection.config.modelIds.length > 0) return provider + " · " + connection.config.modelIds.join(", ");
	return provider;
}

/** Display names for catalogue ids; the catalogue itself lives in providers.ts and must not be imported here. */
const PROVIDER_NAMES: Record<string, string> = {
	openai: "OpenAI", anthropic: "Anthropic", google: "Google", deepseek: "DeepSeek", openrouter: "OpenRouter",
	mistral: "Mistral", groq: "Groq", cerebras: "Cerebras", together: "Together AI", fireworks: "Fireworks AI",
	perplexity: "Perplexity", huggingface: "Hugging Face", siliconflow: "SiliconFlow", ollama: "Ollama", "openai-compatible": CUSTOM_COMPATIBLE_LABEL,
};

export function directProviderLabel(provider: DirectAPIProvider): string {
	switch (provider) {
		case "openai": return "OpenAI";
		case "anthropic": return "Anthropic";
		case "google": return "Google";
		case "openai-compatible": return CUSTOM_COMPATIBLE_LABEL;
	}
}
