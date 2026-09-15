/**
 * Capability parsing.
 *
 * The plugin never hard-codes a model list or an effort ladder — those come
 * from the selected Connection's capabilities response. This parser is deliberately forgiving:
 * a server that returns a plain string array of models is just as acceptable as
 * one that returns rich objects, and anything unrecognised is dropped rather
 * than allowed to break the settings panel.
 *
 * Field names verified against the live Runtime V2:
 *
 *   providers[].id, .available, .effortLevels[]
 *   providers[].models[].id, .displayName, .isDefault, .effortLevels[], .defaultEffort
 *
 * Note `displayName` rather than `label` and `isDefault` rather than `default`.
 * Missing those was why model dropdowns showed raw ids like `gpt-5.6-sol`.
 * Effort levels are per model as well as per provider, and they genuinely
 * differ — `gpt-5.6-sol` offers `ultra`, `gpt-5.5` does not — so a pinned model
 * must narrow the effort list.
 */

import type { Capabilities, EffortCapability, ModelCapability, ProviderCapability } from "./AIBackend";

/**
 * The value that used to mean "let the server choose".
 *
 * It is **not a provider**. The Runtime accepts `codex` or `claude`, or the
 * field omitted entirely, and answers `400` to anything else — including this.
 * The constant survives only so a value stored by an older version can be
 * recognised and dropped on the way out; nothing offers it as a choice.
 */
export const AUTO_PROVIDER = "auto";

/** The empty value in the UI: send no provider and let the server pick. */
export const SERVER_DEFAULT_PROVIDER = "";

/** True when a stored provider must not be put on the wire. */
export function isUnroutableProvider(provider: string | null | undefined): boolean {
	return !provider || provider === AUTO_PROVIDER;
}

/**
 * The same story, one field over.
 *
 * `auto` was offered as an effort and sent verbatim, and the Runtime answers
 * `400 unsupported_effort` to it — measured against the live service, which
 * accepts `high`, `medium` and `low` but not this. It was never a value: it is
 * the writer saying "you decide", and the wire spells that by omitting the
 * field, exactly as it does for a provider.
 *
 * That it worked for a while is what hid it. The service used to advertise an
 * effort ladder and evidently tolerated the word; it advertises none now, and a
 * stored `auto` from those days is still sitting in device settings. Kept as a
 * constant so that value can be recognised and dropped on the way out rather
 * than migrated.
 */
export const AUTO_EFFORT = "auto";

/** The empty value in the UI: send no effort and let the server pick. */
export const SERVER_DEFAULT_EFFORT = "";

/** True when a stored effort must not be put on the wire. */
export function isUnroutableEffort(effort: string | null | undefined): boolean {
	return !effort || effort === AUTO_EFFORT;
}

/**
 * Provider names the way their makers write them.
 *
 * The Runtime reports ids in lowercase (`codex`, `claude`), which is right for a
 * wire format and wrong for a label. Showing `codex` in one place and `Codex` in
 * another reads as two different things.
 */
const CANONICAL_PROVIDER_NAMES: Record<string, string> = {
	auto: "Auto",
	codex: "Codex",
	claude: "Claude",
	openai: "OpenAI",
	anthropic: "Anthropic",
	gemini: "Gemini",
	ollama: "Ollama",
};

/**
 * How a provider should be written wherever it appears.
 *
 * A label the server supplied wins — it knows its own product name. Otherwise a
 * known id is canonicalised, and anything unknown gets its first letter
 * capitalised rather than being shown raw.
 */
export function providerDisplayName(id: string, label?: string): string {
	if (label && label.trim().length > 0) return label;
	const canonical = CANONICAL_PROVIDER_NAMES[id.toLowerCase()];
	if (canonical) return canonical;
	return id.length > 0 ? id[0].toUpperCase() + id.slice(1) : id;
}

/** The display name for a provider id, using the capability list when it has one. */
export function providerNameFrom(capabilities: Capabilities, id: string): string {
	const provider = capabilities.providers.find((candidate) => candidate.id === id);
	return providerDisplayName(id, provider?.label);
}

/** Capabilities used before the server has answered, or when it cannot. */
export function emptyCapabilities(): Capabilities {
	return { providers: [], modes: ["chat", "rewrite"], streaming: true };
}

export function parseCapabilities(raw: unknown): Capabilities {
	if (typeof raw !== "object" || raw === null) return emptyCapabilities();
	const record = raw as Record<string, unknown>;

	const providers = asArray(record.providers)
		.map(parseProvider)
		.filter((provider): provider is ProviderCapability => provider !== null)
		// A provider the Runtime reports as unavailable cannot serve a request,
		// so offering it in a dropdown would only produce a failure later.
		.filter((provider) => provider.available !== false);

	const modes = asArray(record.modes)
		.map((mode) => (typeof mode === "string" ? mode : null))
		.filter((mode): mode is string => mode !== null);

	const defaultProvider =
		typeof record.defaultProvider === "string"
			? record.defaultProvider
			: providers.find((provider) => provider.default)?.id;

	return {
		providers,
		modes: modes.length > 0 ? modes : ["chat", "rewrite"],
		streaming: record.streaming !== false,
		...(defaultProvider ? { defaultProvider } : {}),
	};
}

function parseProvider(raw: unknown): ProviderCapability | null {
	if (typeof raw === "string") {
		return { id: raw, models: [], efforts: [] };
	}
	if (typeof raw !== "object" || raw === null) return null;
	const record = raw as Record<string, unknown>;
	const id = typeof record.id === "string" ? record.id : typeof record.name === "string" ? record.name : null;
	if (!id) return null;

	const label = str(record.label) ?? str(record.displayName);

	return {
		id,
		...(label ? { label } : {}),
		models: asArray(record.models)
			.map(parseModel)
			.filter((model): model is ModelCapability => model !== null),
		efforts: asArray(record.efforts ?? record.effortLevels ?? record.reasoning)
			.map(parseOption)
			.filter((effort): effort is EffortCapability => effort !== null),
		...(record.default === true || record.isDefault === true ? { default: true } : {}),
		...(record.available === false ? { available: false } : {}),
	};
}

function parseModel(raw: unknown): ModelCapability | null {
	const option = parseOption(raw);
	if (!option) return null;
	if (typeof raw !== "object" || raw === null) return option;

	const record = raw as Record<string, unknown>;
	const declaredEfforts = record.effortLevels ?? record.efforts;
	const efforts = asArray(declaredEfforts)
		.map(parseOption)
		.filter((effort): effort is EffortCapability => effort !== null);
	const defaultEffort = str(record.defaultEffort);

	return {
		...option,
		...(declaredEfforts !== undefined ? { efforts } : {}),
		...(defaultEffort ? { defaultEffort } : {}),
	};
}

/** Models and efforts share a shape: an id, an optional label, a default flag. */
function parseOption(raw: unknown): { id: string; label?: string; default?: boolean } | null {
	if (typeof raw === "string") return { id: raw };
	if (typeof raw !== "object" || raw === null) return null;
	const record = raw as Record<string, unknown>;
	const id = typeof record.id === "string" ? record.id : typeof record.name === "string" ? record.name : null;
	if (!id) return null;

	const label = str(record.label) ?? str(record.displayName);
	return {
		id,
		...(label ? { label } : {}),
		...(record.default === true || record.isDefault === true ? { default: true } : {}),
	};
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

/** Look up a provider, tolerating the `auto` sentinel. */
export function findProvider(capabilities: Capabilities, providerId: string): ProviderCapability | undefined {
	if (providerId === AUTO_PROVIDER) {
		const preferred = capabilities.defaultProvider;
		if (preferred) {
			return capabilities.providers.find((provider) => provider.id === preferred);
		}
		return undefined;
	}
	return capabilities.providers.find((provider) => provider.id === providerId);
}

/** Models offered for a provider selection, empty when the server decides. */
export function modelsFor(capabilities: Capabilities, providerId: string): ModelCapability[] {
	return findProvider(capabilities, providerId)?.models ?? [];
}

/**
 * Effort levels offered for a selection.
 *
 * A pinned model narrows the list to what that model actually supports, since
 * the provider-level list is the union across its models.
 */
export function effortsFor(
	capabilities: Capabilities,
	providerId: string,
	modelId?: string,
): EffortCapability[] {
	const provider = findProvider(capabilities, providerId);
	if (!provider) return [];

	if (modelId) {
		const model = provider.models.find((candidate) => candidate.id === modelId);
		if (!model) return [];
		// An explicitly empty list means unsupported. Older Runtime capability
		// payloads may omit the model field and declare one provider-wide ladder.
		return model.efforts ?? provider.efforts;
	}
	return provider.efforts;
}
