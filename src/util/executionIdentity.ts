import type { GenerationMetadata, SessionPreferences } from "../types";

/**
 * Provider/model/effort values are machine identifiers, not status prose.
 * Keep the grammar deliberately small at untrusted persistence/protocol edges.
 */
export function executionIdentity(value: unknown, allowProviderDefault = false): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	if (allowProviderDefault && trimmed === "(provider default)") return trimmed;
	if (trimmed.length === 0 || trimmed.length > 200) return undefined;
	return /^[A-Za-z0-9][A-Za-z0-9._:/+@-]*$/u.test(trimmed) ? trimmed : undefined;
}

/** The execution target explicitly selected by the writer before a call starts. */
export function selectedExecutionIdentity(
	preferences: Readonly<SessionPreferences>,
): Pick<GenerationMetadata, "provider" | "model" | "effort"> {
	const provider = executionIdentity(preferences.provider);
	const model = executionIdentity(preferences.model, true);
	const effort = executionIdentity(preferences.effort);
	return {
		...(provider ? { provider } : {}),
		...(model ? { model } : {}),
		...(effort ? { effort } : {}),
	};
}

/** Restore selected identity after a call ends without a usable result. */
export function restoreSelectedExecutionIdentity(
	metadata: GenerationMetadata,
	selected: Readonly<Pick<SessionPreferences, "provider" | "model" | "effort">>,
): void {
	for (const key of ["provider", "model", "effort"] as const) {
		const value = selected[key];
		if (value) metadata[key] = value;
		else delete metadata[key];
	}
}

/** Replace an execution identity as one tuple so fields from two attempts never mix. */
export function replaceExecutionIdentity(
	metadata: GenerationMetadata,
	identity: Readonly<Pick<GenerationMetadata, "provider" | "model" | "effort">> | undefined,
): void {
	if (!identity || ![identity.provider, identity.model, identity.effort].some(Boolean)) return;
	delete metadata.provider;
	delete metadata.model;
	delete metadata.effort;
	if (identity.provider) metadata.provider = identity.provider;
	if (identity.model) metadata.model = identity.model;
	if (identity.effort) metadata.effort = identity.effort;
}
