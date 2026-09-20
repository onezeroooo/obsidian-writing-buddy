import type { AIConnection } from "../connections/types";
import { connectionSnapshot } from "../connections/types";
import type { EffortCapability } from "../backend/AIBackend";
import { defaultEffortFor, resolveEffort } from "../backend/effort";
import type { SessionPreferences } from "../types";

/**
 * Resolve the Composer state for one conversation on this device.
 *
 * A stored per-session choice is authoritative even when its Connection was
 * removed or disabled: keeping the stale id makes the UI explain the problem
 * instead of silently switching the request to another account. Legacy
 * preferences from synced conversation JSON are intentionally not consulted.
 */
export function effectiveComposerPreferences(
	local: SessionPreferences | null,
	defaults: SessionPreferences,
): SessionPreferences {
	return stripEmptyPreferences(local ?? { contextDepth: "auto", ...defaults });
}

/** Apply one Composer gesture while clearing values that no longer compose. */
export function updateComposerPreferences(
	current: SessionPreferences,
	patch: Partial<SessionPreferences>,
	connection: AIConnection | null,
	effortsForModel: (connectionId: string | undefined, provider: string, model: string | undefined) => readonly EffortCapability[],
): SessionPreferences {
	const next: SessionPreferences = { ...current, ...patch };
	if (patch.connectionId !== undefined) {
		// The Composer selects a Connection and a Provider as one gesture, so a
		// Provider supplied with the Connection is the choice, not leftover state.
		if (patch.provider === undefined) delete next.provider;
		delete next.model;
		delete next.effort;
		delete next.connectionName;
		delete next.connectionType;
		delete next.connectionDetail;
		if (connection && connection.id === patch.connectionId) {
			const snapshot = connectionSnapshot(connection);
			next.connectionName = snapshot.name;
			next.connectionType = snapshot.type;
			if (snapshot.detail) next.connectionDetail = snapshot.detail;
		}
	}
	if (patch.provider !== undefined) {
		delete next.model;
		delete next.effort;
	}
	if (patch.model !== undefined) {
		// A new model starts at its ladder's default; one without a ladder
		// carries no effort.
		const effort = defaultEffortFor(effortsForModel(next.connectionId, next.provider ?? "", patch.model));
		if (effort) next.effort = effort;
		else delete next.effort;
	}
	return stripEmptyPreferences(next);
}

/**
 * Put a conversation's effort onto the model's current ladder.
 *
 * Stored preferences can carry a level the model no longer offers — an older
 * install's `auto`, or a ladder that changed after discovery — or none at all.
 * Both read as the default rather than as an empty row the writer must fill.
 */
export function withResolvedEffort(preferences: SessionPreferences, efforts: readonly EffortCapability[]): SessionPreferences {
	const effort = resolveEffort(preferences.effort, efforts);
	if (effort === preferences.effort) return preferences;
	const next = { ...preferences };
	if (effort) next.effort = effort;
	else delete next.effort;
	return next;
}

/** Drop empty values before device-local persistence or request execution. */
export function stripEmptyPreferences(preferences: SessionPreferences): SessionPreferences {
	const next: SessionPreferences = {};
	if (preferences.connectionId) next.connectionId = preferences.connectionId;
	if (preferences.connectionName) next.connectionName = preferences.connectionName;
	if (preferences.connectionType) next.connectionType = preferences.connectionType;
	if (preferences.connectionDetail) next.connectionDetail = preferences.connectionDetail;
	if (preferences.provider) next.provider = preferences.provider;
	if (preferences.model) next.model = preferences.model;
	if (preferences.effort) next.effort = preferences.effort;
	if (preferences.contextDepth) next.contextDepth = preferences.contextDepth;
	return next;
}
