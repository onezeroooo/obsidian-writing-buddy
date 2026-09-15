import {
	DEFAULT_LOCAL_OPENAI_BASE_URL,
	DEFAULT_OLLAMA_BASE_URL,
	type AIConnection,
	type DirectAPIProvider,
	type LocalEngine,
} from "./types";

export const CONNECTION_SETTINGS_VERSION = 2;

export function upsertConnection(connections: AIConnection[], connection: AIConnection): AIConnection[] {
	return [...connections.filter((item) => item.id !== connection.id), connection];
}

export function parseConnections(raw: unknown): AIConnection[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<string>();
	const result: AIConnection[] = [];
	for (const value of raw) {
		const parsed = parseConnection(value);
		if (!parsed || seen.has(parsed.id)) continue;
		seen.add(parsed.id);
		result.push(parsed);
	}
	return result;
}

function parseConnection(value: unknown): AIConnection | null {
	if (!record(value)) return null;
	const id = str(value.id);
	const name = str(value.name);
	if (!id || !/^conn_[a-z0-9_-]+$/.test(id) || !name?.trim()) return null;
	const enabled = value.enabled !== false;
	if (!record(value.config)) return null;
	const providerId = str(value.providerId);
	const identity = providerId && /^[a-z][a-z0-9-]*$/.test(providerId) ? { providerId } : {};

	if (value.type === "direct-api") {
		const provider = parseDirectProvider(value.config.provider);
		if (!provider) return null;
		return {
			id, name: name.trim(), ...identity, type: "direct-api", enabled,
			config: {
				provider,
				apiKey: str(value.config.apiKey)?.trim() ?? "",
				baseUrl: str(value.config.baseUrl)?.trim() ?? "",
				modelIds: strings(value.config.modelIds),
			},
		};
	}

	if (value.type === "local") {
		const engine = parseLocalEngine(value.config.engine);
		if (!engine) return null;
		return {
			id, name: name.trim(), ...identity, type: "local", enabled,
			config: {
				engine,
				baseUrl: str(value.config.baseUrl)?.trim() || defaultLocalBaseUrl(engine),
				apiKey: str(value.config.apiKey)?.trim() ?? "",
			},
		};
	}
	return null;
}

function parseLocalEngine(value: unknown): LocalEngine | null {
	if (value === "ollama") return value;
	// Accept the implementation name written by early development builds, but
	// persist one protocol-oriented value in the public connection schema.
	if (value === "openai-compatible" || value === "llama.cpp") return "openai-compatible";
	return null;
}

function defaultLocalBaseUrl(engine: LocalEngine): string {
	return engine === "ollama" ? DEFAULT_OLLAMA_BASE_URL : DEFAULT_LOCAL_OPENAI_BASE_URL;
}

function parseDirectProvider(value: unknown): DirectAPIProvider | null {
	return value === "openai" || value === "anthropic" || value === "google" || value === "openai-compatible"
		? value : null;
}

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
function str(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function strings(value: unknown): string[] {
	return Array.isArray(value)
		? [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))]
		: [];
}
