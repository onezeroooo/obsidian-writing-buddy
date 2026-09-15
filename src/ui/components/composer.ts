/**
 * The composer: one shell containing the writing actions, the active context,
 * the input, the parameter row, and send/stop.
 *
 * Previously these were four separate blocks sitting next to each other, which
 * read as loose controls rather than a place to write. They are now inside a
 * single bordered surface with hairline dividers, so the boundary of "the thing
 * I type into" is unambiguous.
 *
 * Two rules hold throughout.
 *
 * The text box is the primary control, so the parameter row is small,
 * borderless and label-led — `Provider: Claude`, not four select boxes.
 *
 * And the row shows what **this conversation on this device** is actually
 * using. New and untouched conversations use this device's visible preset;
 * changing a value here creates a local conversation override and never
 * changes that preset.
 *
 * `Effort` and `Context` are deliberately separate. Effort is the model's
 * reasoning budget; Context selects the information-access intent: Agent-led
 * research, complete corpus coverage, or local-only context.
 */

import { Menu } from "obsidian";
import { t } from "../../i18n";
import type { Capabilities, EffortCapability, ModelCapability } from "../../backend/AIBackend";
import type { ContextDepth, SelectionAttachment, SessionPreferences, Skill } from "../../types";
import { SERVER_DEFAULT_EFFORT, isUnroutableEffort, providerDisplayName } from "../../backend/capabilities";
import { CONTEXT_DEPTHS, contextDepthLabel } from "../../context/types";
import type { AIConnection, ConnectionHealth } from "../../connections/types";
import { ICONS, iconButton, iconSpan } from "../icons";
import { renderAttachmentChip } from "./attachmentChip";

/**
 * Skills that never appear as a bottom shortcut.
 *
 * Selection Chat belongs to the editor: you select a passage and ask about it
 * from there. A permanent button duplicating that flow taught the wrong entry
 * point and took up the row.
 */
export const EXCLUDED_QUICK_ACTIONS = new Set(["ask-selection"]);

/** How many actions stay on the row before the rest move into the menu. */
export const MAX_VISIBLE_ACTIONS = 4;

/** Shown by any parameter the writer has not chosen yet. A function: a module
 * constant would freeze whichever locale was live at import time. */
export function unsetLabel(): string {
	return t("composer.unset");
}

export interface QuickActionSplit {
	visible: Skill[];
	overflow: Skill[];
}

/** Choose the writing actions to show. */
export function quickActions(
	skills: Skill[],
	maxVisible = MAX_VISIBLE_ACTIONS,
	activeSkillId?: string,
): QuickActionSplit {
	const usable = skills.filter((skill) => !EXCLUDED_QUICK_ACTIONS.has(skill.id));
	const seen = new Set<string>();
	const deduped = usable.filter((skill) => {
		if (seen.has(skill.id)) return false;
		seen.add(skill.id);
		return true;
	});
	const activeIndex = activeSkillId ? deduped.findIndex((skill) => skill.id === activeSkillId) : -1;
	if (activeIndex >= maxVisible && maxVisible > 0) {
		const active = deduped[activeIndex];
		const promoted = [active, ...deduped.filter((skill) => skill.id !== active.id)];
		return { visible: promoted.slice(0, maxVisible), overflow: promoted.slice(maxVisible) };
	}
	return { visible: deduped.slice(0, maxVisible), overflow: deduped.slice(maxVisible) };
}

// ---------------------------------------------------------------------------
// Selector values
// ---------------------------------------------------------------------------

export interface SelectOption {
	value: string;
	label: string;
}

export interface ParameterValueState {
	text: string;
	selected: boolean;
	unavailable: boolean;
}

/** A readable Effort label when only its persisted wire value is available. */
export function effortDisplayName(id: string, label?: string): string {
	if (label && label.trim().length > 0) return label;
	return id.length > 0 ? id[0].toUpperCase() + id.slice(1) : id;
}

/**
 * Resolve what a parameter button says without erasing a persisted choice.
 *
 * An empty capability list means discovery has not produced an authoritative
 * answer yet, so the saved label remains a normal selected value. Once the
 * server has returned capabilities, an absent value remains visible but is
 * explicitly marked unavailable.
 */
export function parameterValueState(
	value: string | undefined,
	choices: SelectOption[],
	savedLabel: string | undefined,
	choicesAreAuthoritative: boolean,
	unsupported = false,
): ParameterValueState {
	const chosen = choices.find((choice) => choice.value === value);
	if (chosen) return { text: chosen.label, selected: true, unavailable: false };
	if (value && savedLabel) {
		const unavailable = choicesAreAuthoritative;
		return {
			text: unavailable ? t("composer.unavailableSuffix", { label: savedLabel }) : savedLabel,
			selected: true,
			unavailable,
		};
	}
	return {
		text: unsupported ? "—" : unsetLabel(),
		selected: false,
		unavailable: false,
	};
}

export function connectionOptions(connections: AIConnection[]): SelectOption[] {
	return connections
		.filter((connection) => connection.enabled)
		.map((connection) => ({ value: connection.id, label: connection.name }));
}

/**
 * Separator inside a Composer Provider choice.
 *
 * A choice names a Connection and a Provider together, because a Provider on
 * its own is not a routable answer to "where does this turn run". Connection
 * ids are generated (`conn_` + token) and cannot contain this.
 */
export const PROVIDER_CHOICE_SEPARATOR = "::";

export function providerChoiceValue(connectionId: string, provider: string): string {
	return `${connectionId}${PROVIDER_CHOICE_SEPARATOR}${provider}`;
}

export function parseProviderChoice(value: string): { connectionId: string; provider: string } | null {
	const at = value.indexOf(PROVIDER_CHOICE_SEPARATOR);
	if (at <= 0) return null;
	const connectionId = value.slice(0, at);
	const provider = value.slice(at + PROVIDER_CHOICE_SEPARATOR.length);
	return provider.length > 0 ? { connectionId, provider } : null;
}

/**
 * Every Provider a writer can actually reach, across enabled Connections.
 *
 * The Composer asks which model writes this turn, not which account it is
 * billed to. Making Connection the first choice meant a writer who knew they
 * wanted one Provider had to remember which Connection carried it, and a
 * Connection with nothing enabled behind it still occupied the first slot.
 * Settings keeps Connection identity primary; only this picker is flattened.
 *
 * A Provider name that appears behind more than one Connection is qualified by
 * its Connection, and only then — an unambiguous name needs no explanation. A
 * direct connection names its one Provider after itself ("Tidewire"), so the
 * qualifier is also skipped when it would only repeat the label.
 */
export function crossConnectionProviderOptions(
	connections: readonly AIConnection[],
	capabilitiesFor: (connectionId: string) => Capabilities,
): SelectOption[] {
	const enabled = connections.filter((connection) => connection.enabled);
	const entries = enabled.flatMap((connection) =>
		capabilitiesFor(connection.id).providers.map((provider) => ({
			connection,
			provider: provider.id,
			label: providerDisplayName(provider.id, provider.label),
		})));
	const counts = new Map<string, number>();
	for (const entry of entries) counts.set(entry.label, (counts.get(entry.label) ?? 0) + 1);
	return entries.map((entry) => ({
		value: providerChoiceValue(entry.connection.id, entry.provider),
		label: (counts.get(entry.label) ?? 0) > 1 && entry.label !== entry.connection.name
			? `${entry.label} · ${entry.connection.name}`
			: entry.label,
	}));
}

/**
 * Provider choices for one Connection, written the way their makers write them.
 *
 * There is no `Auto` or synthetic default.
 */
export function providerOptions(capabilities: Capabilities): SelectOption[] {
	return capabilities.providers.map((provider) => ({
			value: provider.id,
			label: providerDisplayName(provider.id, provider.label),
		}));
}

/**
 * Context expresses three distinct intents: Auto lets the Agent decide whether
 * to research, Full requires complete corpus coverage, and Low stays local.
 */
export function contextDepthOptions(): SelectOption[] {
	return CONTEXT_DEPTHS.map((depth) => ({ value: depth.id, label: contextDepthLabel(depth.id) }));
}

/** Model choices. No synthetic "默认" entry: only models the server offers. */
export function modelOptions(models: ModelCapability[]): SelectOption[] {
	return models.map((model) => ({ value: model.id, label: model.label ?? model.id }));
}

/**
 * Effort choices, on the same terms, plus the one entry that is not a value.
 *
 * The first row used to read `Auto` and carry `"auto"`, which was sent verbatim
 * and answered with `400 unsupported_effort`. It is not an effort the server
 * has; it is the writer declining to pick one, so it carries the empty value
 * and `buildChatBody` omits the field entirely — the same shape `provider`
 * already uses for the same reason.
 *
 * It is offered even when the server advertises no ladder at all, which is the
 * current state of the measured Runtime: with nothing to choose between, "let
 * the server decide" is the only honest thing the row can say.
 */
export function effortOptions(efforts: EffortCapability[]): SelectOption[] {
	return [
		{ value: SERVER_DEFAULT_EFFORT, label: t("composer.effortServerDefault") },
		...efforts.map((effort) => ({ value: effort.id, label: effort.label ?? effort.id })),
	];
}

/**
 * Which parameters are still unset, in display order.
 *
 * Every effective value is visible conversation state. It may come from the
 * device preset until this conversation is locally adjusted, but sending never
 * invents or silently substitutes a missing selection.
 */
export function missingSelections(preferences: SessionPreferences): string[] {
	const missing: string[] = [];
	if (!preferences.connectionId) missing.push(t("label.connection"));
	if (!preferences.provider) missing.push(t("label.provider"));
	if (!preferences.model) missing.push(t("label.model"));
	// Effort is not here. An unset effort is now a choice — the first row of the
	// dropdown — and it sends no effort field at all, so there is nothing left
	// for the writer to supply. Requiring it was what made `"auto"` necessary in
	// the first place: something had to fill the slot, and the only word to hand
	// was one the server does not accept.
	if (!preferences.contextDepth) missing.push(t("label.context"));
	return missing;
}

/** True when this turn may be sent. */
export function canSend(
	value: string,
	preferences: SessionPreferences,
	busy: boolean,
	/**
	 * Retained so the positional call sites keep their meaning, and ignored.
	 *
	 * It existed to waive the Effort requirement when the server advertised no
	 * ladder. There is no requirement to waive now: declining an effort is a
	 * choice, and it sends no field.
	 */
	_effortSupported = true,
	connectionReady = true,
	selectionAvailable = true,
	activeSkill: Skill | null = null,
): boolean {
	// A pressed action is a request on its own: the Skill carries the
	// instructions and the passage is attached. Requiring a sentence as well
	// asked the writer to say what the button already said.
	const hasSomethingToSay = value.trim().length > 0 || activeSkill !== null;
	return !busy && connectionReady && selectionAvailable && hasSomethingToSay &&
		missingSelections(preferences).length === 0;
}

/** Transient request failures remain retryable; configuration failures do not. */
export function connectionAllowsSend(connection: AIConnection | null, health: ConnectionHealth): boolean {
	if (!connection?.enabled) return false;
	return health.kind !== "auth-error" && health.kind !== "disabled" && health.kind !== "checking";
}

export function selectionIsAvailable(capabilities: Capabilities, preferences: SessionPreferences): boolean {
	if (!preferences.provider || !preferences.model) return false;
	// No providers means discovery is pending or temporarily unavailable, not
	// that the saved selection is stale. Routing applies the same rule and lets
	// the adapter validate its own contract, which keeps offline retry possible.
	if (capabilities.providers.length === 0) return true;
	const provider = capabilities.providers.find((item) => item.id === preferences.provider);
	const model = provider?.models.find((item) => item.id === preferences.model);
	if (!provider || !model) return false;
	const efforts = model.efforts ?? provider.efforts;
	// Declining to choose is always valid — it puts no effort on the wire. A
	// named one has to be named by the server. The old form of this line let
	// `"auto"` through unconditionally, which is how a value the dropdown could
	// not offer and the server would not accept stayed valid for months.
	if (isUnroutableEffort(preferences.effort)) return true;
	return efforts.some((item) => item.id === preferences.effort);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export interface ComposerOptions {
	value: string;
	/** Any view owns the plugin's single foreground turn. */
	busy: boolean;
	/** This Composer owns that turn and may therefore stop it. */
	ownsBusy: boolean;
	skills: Skill[];
	capabilities: Capabilities;
	connections: AIConnection[];
	/** Capabilities of any enabled Connection, for the flattened Provider list. */
	capabilitiesFor: (connectionId: string) => Capabilities;
	selectedConnection: AIConnection | null;
	selectedConnectionHealth: ConnectionHealth;
	preferences: SessionPreferences;
	models: ModelCapability[];
	efforts: EffortCapability[];
	/** The passage currently carried into new turns, if any. */
	activeContext: SelectionAttachment | null;
	/** Explicit Action selected for this draft; visible and toggleable. */
	activeSkill?: Skill | null;

	onInput: (value: string) => void;
	onSend: () => void;
	onStop: () => void;
	onRunSkill: (skill: Skill) => void;
	onClearContext: () => void;
	onOpenContext: (attachment: SelectionAttachment) => void;
	onPreferenceChange: (patch: Partial<SessionPreferences>) => void;
}

export type ComposerTurnControl = "send" | "stop" | "blocked";

/** Keep Stop exclusive to the owner while every other view is fail-closed. */
export function composerTurnControl(busy: boolean, ownsBusy: boolean): ComposerTurnControl {
	if (!busy) return "send";
	return ownsBusy ? "stop" : "blocked";
}

export function renderComposer(parent: HTMLElement, options: ComposerOptions): void {
	// A re-render replaces the controls these menus are anchored to, so any menu
	// still open belongs to a button that no longer exists.
	closeOpenParamMenu();

	const composer = parent.createDiv({ cls: "wb-composer" });
	const shell = composer.createDiv({ cls: "wb-shell" });

	renderActionRow(shell, options);

	const input = shell.createEl("textarea", {
		cls: "wb-input",
		attr: {
			rows: "2",
			// With an action pressed the box is optional, and saying so is the
			// only way anyone discovers that.
			placeholder: options.activeSkill ? t("composer.placeholderSkill") : t("composer.placeholder"),
			"aria-label": t("composer.inputAria"),
		},
	});
	input.value = options.value;
	let sendButton: HTMLButtonElement | null = null;
	const readyToSend = (): boolean => canSend(
		input.value,
		options.preferences,
		options.busy,
		options.efforts.length > 0,
		connectionAllowsSend(options.selectedConnection, options.selectedConnectionHealth),
		selectionIsAvailable(options.capabilities, options.preferences),
		options.activeSkill ?? null,
	);
	const refreshSendButton = (): void => {
		if (!sendButton) return;
		const ready = readyToSend();
		sendButton.toggleClass("is-disabled", !ready);
		sendButton.disabled = !ready;
	};
	input.addEventListener("input", () => {
		options.onInput(input.value);
		autoGrow(input);
		refreshSendButton();
	});
	input.addEventListener("keydown", (event) => {
		if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			if (readyToSend()) options.onSend();
		}
	});
	autoGrow(input);

	const controls = shell.createDiv({ cls: "wb-composer-controls" });
	renderSelectors(controls, options);

	// Send and Stop share one visual system, and neither carries Obsidian's
	// large dark tooltip: it lands on top of a control in the bottom-right
	// corner of the pane, covering the thing it describes. The accessible name
	// stays, and the hover state is the affordance.
	const slot = controls.createDiv({ cls: "wb-send-slot" });
	const turnControl = composerTurnControl(options.busy, options.ownsBusy);
	if (turnControl === "stop") {
		iconButton(slot, {
			icon: ICONS.stop,
			label: t("composer.stop"),
			cls: "wb-send-btn is-stop",
			tooltip: false,
			onClick: () => options.onStop(),
		});
	} else {
		const button = iconButton(slot, {
			icon: ICONS.send,
			label: t("composer.send"),
			cls: "wb-send-btn",
			tooltip: false,
			onClick: () => options.onSend(),
		});
		sendButton = button;
		refreshSendButton();
		if (turnControl === "blocked") button.setAttribute("aria-label", t("composer.otherWindowBusy"));
	}

	renderValidation(composer, options);
}

/**
 * Inline, quiet, and only when it applies.
 *
 * A blocked send explains itself next to the controls that are blocking it,
 * rather than through a dialog after the writer has already pressed send.
 */
function renderValidation(parent: HTMLElement, options: ComposerOptions): void {
	if (options.busy) {
		if (!options.ownsBusy) {
			parent.createDiv({ cls: "wb-composer-hint", attr: { role: "status" }, text: t("composer.otherWindowBusyHint") });
		}
		return;
	}
	const missing = missingSelections(options.preferences);
	const hint = parent.createDiv({ cls: "wb-composer-hint", attr: { role: "status" } });
	if (options.preferences.connectionId && !options.selectedConnection) {
		hint.setText(t("composer.connectionRemoved", { name: options.preferences.connectionName ?? t("composer.selectedConnection") }));
		return;
	}
	if (options.preferences.connectionId && !connectionAllowsSend(options.selectedConnection, options.selectedConnectionHealth)) {
		hint.setText(t("composer.connectionState", { name: options.selectedConnection?.name ?? t("composer.selectedConnection"), state: connectionHealthPhrase(options.selectedConnectionHealth) }));
		return;
	}
	if (missing.length === 0 && !selectionIsAvailable(options.capabilities, options.preferences)) {
		hint.setText(t("composer.comboUnsupported"));
		return;
	}
	if (missing.length === 0 && (options.selectedConnectionHealth.kind === "offline" || options.selectedConnectionHealth.kind === "unavailable")) {
		hint.setText(t("composer.retryHint", { name: options.selectedConnection?.name ?? t("composer.selectedConnection") }));
		return;
	}
	if (missing.length === 0) { hint.remove(); return; }
	if (options.capabilities.providers.length === 0 && options.preferences.connectionId) {
		hint.setText(t("composer.testFirst"));
		return;
	}
	hint.setText(t("composer.selectBeforeSend", { missing: missing.join(" / ") }));
}

function connectionHealthPhrase(health: ConnectionHealth): string {
	switch (health.kind) {
		case "offline": return t("healthPhrase.offline");
		case "auth-error": return t("healthPhrase.authError");
		case "disabled": return t("healthPhrase.disabled");
		case "checking": return t("healthPhrase.checking");
		case "unavailable": return t("healthPhrase.unavailable");
		case "unknown": return t("healthPhrase.unknown");
		case "connected": return t("healthPhrase.connected");
	}
}

export function renderActionRow(parent: HTMLElement, options: ComposerOptions): void {
	// The row always occupies its slot, and its structure never changes.
	// Writers select and deselect constantly while reading; a row that existed
	// only alongside a selection moved the whole transcript by its own height
	// on every one of those gestures. Reserved space fixes the movement, and
	// keeping the same buttons in both states — disabled until a selection
	// exists — fixes the content flicker a wholesale swap would reintroduce.
	// The left end is the only part that changes: blank without a selection,
	// the passage chip with one. No hint text — the disabled buttons carry
	// their own explanation in their tooltips, and a sentence that sat there
	// permanently would be furniture, not information.
	const active = Boolean(options.activeContext);
	const row = parent.createDiv({ cls: active ? "wb-context-actions" : "wb-context-actions is-empty" });
	renderActiveContext(row, options);

	const { visible, overflow } = quickActions(options.skills, MAX_VISIBLE_ACTIONS, options.activeSkill?.id);
	if (visible.length === 0 && overflow.length === 0) return;

	const actions = row.createDiv({ cls: "wb-actions" });
	const blockedTitle = t("composer.selectTextFirst");

	const buttons: Array<{ skill: Skill; button: HTMLButtonElement }> = [];
	for (const skill of visible) {
		const pressed = options.activeSkill?.id === skill.id;
		const button = actions.createEl("button", {
			cls: `wb-action${pressed ? " is-active" : ""}`,
			text: skill.name,
			attr: {
				type: "button",
				title: !active ? blockedTitle : pressed ? t("composer.cancelAction", { name: skill.name }) : (skill.description ?? skill.name),
				"aria-pressed": pressed ? "true" : "false",
			},
		});
		button.disabled = options.busy || !active;
		button.addEventListener("click", () => options.onRunSkill(skill));
		buttons.push({ skill, button });
	}

	// What the menu lists: the count overflow plus whatever the fit pass below
	// demotes. Mutable so the click handler always reads the current split.
	let menuSkills: Skill[] = [...overflow];

	const more = actions.createEl("button", {
		cls: "wb-action wb-action-more",
		// The blocked hint rides the aria-label instead of a `title`, which
		// would hover a second, native tooltip next to Obsidian's.
		attr: { type: "button", "aria-label": active ? t("composer.moreActionsAria") : t("composer.moreActionsBlockedAria", { hint: blockedTitle }) },
	});
	iconSpan(more, ICONS.skills);
	more.createSpan({ text: t("composer.more") });
	more.disabled = options.busy || !active;
	if (menuSkills.length === 0) more.style.display = "none";
	more.addEventListener("click", (event) => {
		const menu = new Menu();
		for (const skill of menuSkills) {
			menu.addItem((item) => item
				.setTitle(skill.name)
				.setChecked(options.activeSkill?.id === skill.id)
				.onClick(() => options.onRunSkill(skill)));
		}
		menu.showAtMouseEvent(event);
	});

	// MAX_VISIBLE_ACTIONS is only a ceiling; the row measures itself and
	// demotes trailing buttons into the menu until everything fits. Names are
	// content — a writer's own skill, or an English catalog — so no width
	// assumption survives contact with them. The row never wraps or scrolls,
	// which is the same "the row does not move" promise as above.
	const fit = (): void => {
		for (const { button } of buttons) button.style.display = "";
		menuSkills = [...overflow];
		more.style.display = menuSkills.length === 0 ? "none" : "";
		// A detached or unmeasured row reports zero width; keep the count-based
		// split rather than demoting everything into the menu.
		if (row.clientWidth === 0) return;
		for (let index = buttons.length - 1; index >= 0 && row.scrollWidth > row.clientWidth; index -= 1) {
			const demoted = buttons[index];
			demoted.button.style.display = "none";
			menuSkills = [demoted.skill, ...menuSkills];
			more.style.display = "";
		}
	};
	// The observer fires once on observe with real geometry — that is the
	// initial fit — and again whenever the pane is resized. It dies with the
	// row: nothing else references it, so a re-render lets both be collected.
	if (typeof ResizeObserver !== "undefined") {
		new ResizeObserver(fit).observe(row);
	}
}

/**
 * The passage new turns will carry, shown as the same quoted citation used in
 * the transcript so the two read as the same kind of thing.
 *
 * It no longer carries a `只读上下文` tag. The behaviour is unchanged — a chat
 * turn has no editor in scope and cannot modify the manuscript — but the label
 * was restating a guarantee the interface already keeps.
 */
function renderActiveContext(parent: HTMLElement, options: ComposerOptions): void {
	const attachment = options.activeContext;
	if (!attachment) return;

	const strip = parent.createDiv({ cls: "wb-context" });
	renderAttachmentChip(strip, {
		attachment,
		onOpen: options.onOpenContext,
		onRemove: options.onClearContext,
	});
}

function renderSelectors(parent: HTMLElement, options: ComposerOptions): void {
	const group = parent.createDiv({ cls: "wb-selectors" });
	const capabilitiesKnown = options.capabilities.providers.length > 0;

	const providerChoices = crossConnectionProviderOptions(options.connections, options.capabilitiesFor);
	const hasEnabledConnection = options.connections.some((connection) => connection.enabled);
	param(group, {
		label: t("label.provider"),
		choices: providerChoices,
		value: options.preferences.connectionId && options.preferences.provider
			? providerChoiceValue(options.preferences.connectionId, options.preferences.provider)
			: undefined,
		// A stored choice whose Connection was disabled or removed still says
		// what it was, qualified, rather than reading as nothing selected.
		savedLabel: options.preferences.provider
			? qualifiedProviderLabel(options.preferences.provider, options.preferences.connectionName)
			: undefined,
		choicesAreAuthoritative: capabilitiesKnown,
		empty: hasEnabledConnection
			? t("composer.noProviders")
			: t("composer.addConnectionFirst"),
		onChange: (value) => {
			const choice = parseProviderChoice(value);
			if (!choice) return;
			// One gesture, one routing decision: Connection and Provider move
			// together, and Model/Effort are re-resolved for the pair.
			options.onPreferenceChange({ connectionId: choice.connectionId, provider: choice.provider });
		},
	});

	param(group, {
		label: t("label.model"),
		choices: modelOptions(options.models),
		value: options.preferences.model,
		savedLabel: options.preferences.model,
		choicesAreAuthoritative: capabilitiesKnown,
		empty: options.preferences.provider ? t("composer.noModels") : t("composer.selectProviderFirst"),
		onChange: (value) => options.onPreferenceChange({ model: value }),
	});

	param(group, {
		label: t("label.effort"),
		choices: effortOptions(options.efforts),
		value: options.preferences.effort,
		savedLabel: options.preferences.effort ? effortDisplayName(options.preferences.effort) : undefined,
		choicesAreAuthoritative: capabilitiesKnown,
		empty: options.preferences.model ? t("common.unsupported") : t("composer.selectModelFirst"),
		unsupported: capabilitiesKnown && Boolean(options.preferences.model) && options.efforts.length === 0,
		onChange: (value) => options.onPreferenceChange({ effort: value }),
	});

	// Context is ours, not the Runtime's, so it is always selectable —
	// even before a connection has ever been made. Product order is intentional:
	// these are distinct execution intents, not a low-to-high slider.
	param(group, {
		label: t("label.context"),
		choices: contextDepthOptions(),
		value: options.preferences.contextDepth,
		empty: "",
		onChange: (value) => options.onPreferenceChange({ contextDepth: value as ContextDepth }),
	});
}

/** A saved Provider, named with its Connection when we still know it. */
function qualifiedProviderLabel(provider: string, connectionName: string | undefined): string {
	const name = providerDisplayName(provider);
	return connectionName ? `${name} · ${connectionName}` : name;
}

interface ParamOptions {
	label: string;
	choices: SelectOption[];
	value: string | undefined;
	/** Readable form of an explicit persisted value missing from choices. */
	savedLabel?: string;
	/** True only after capabilities provide an authoritative option list. */
	choicesAreAuthoritative?: boolean;
	/** Shown in the popover when the server offers nothing to choose from. */
	empty: string;
	unsupported?: boolean;
	onChange: (value: string) => void;
}

/**
 * A `Label: value` pair whose value opens a popover.
 *
 * A menu rather than a `<select>`: it can say why a list is empty, it can carry
 * a selected state, and Obsidian flips it upward on its own when the control is
 * near the bottom of the window — which, in the composer footer, it always is.
 */
function param(parent: HTMLElement, options: ParamOptions): void {
	const wrap = parent.createDiv({ cls: "wb-param" });
	wrap.createSpan({ cls: "wb-param-label", text: `${options.label}:` });

	const state = parameterValueState(
		options.value,
		options.choices,
		options.savedLabel,
		options.choicesAreAuthoritative === true,
		options.unsupported === true,
	);
	const button = wrap.createEl("button", {
		cls: `wb-param-value${state.selected ? "" : " is-unset"}${options.unsupported ? " is-disabled" : ""}${state.unavailable ? " is-unavailable" : ""}`,
		text: state.text,
		attr: {
			type: "button",
			"aria-haspopup": "listbox",
			"aria-label": `${options.label}：${state.selected ? state.text : options.empty}`,
		},
	});
	button.disabled = options.unsupported === true;

	// One gesture, one list. No tooltip: the label beside it already says what
	// this is, and a dark block over the composer says it a second time.
	const build = (event: MouseEvent): void => {
		// Only one parameter list at a time.
		closeOpenParamMenu();

		const menu = new Menu().setUseNativeMenu(false).setParentElement(wrap);
		if (state.unavailable) {
			menu.addItem((item) => item.setTitle(state.text).setChecked(true).setDisabled(true));
		}
		if (options.choices.length === 0) {
			menu.addItem((item) => item.setTitle(options.empty).setDisabled(true));
		}
		for (const choice of options.choices) {
			menu.addItem((item) =>
				item
					.setTitle(choice.label)
					.setChecked(choice.value === options.value)
					.onClick(() => options.onChange(choice.value)),
			);
		}

		menu.onHide(() => {
			if (openParamMenu?.menu === menu) {
				openParamMenu = null;
			}
			wrap.removeClass("is-open");
		});

		wrap.addClass("is-open");
		menu.showAtMouseEvent(event);
		openParamMenu = { menu, wrap };
	};

	button.addEventListener("click", (event) => {
		// Clicking the control that is already open closes it, rather than
		// rebuilding the same list underneath the pointer.
		if (openParamMenu?.wrap === wrap) {
			closeOpenParamMenu();
			return;
		}
		build(event);
	});
}

/**
 * The one parameter list that may be open, and the control it belongs to.
 *
 * Module-level because the invariant is across the whole row: opening any of
 * them closes whichever was open, and only one can be visible at a time.
 */
let openParamMenu: { menu: Menu; wrap: HTMLElement } | null = null;

/** Close the open parameter list, if there is one. Safe to call at any time. */
export function closeOpenParamMenu(): void {
	const open = openParamMenu;
	openParamMenu = null;
	if (!open) return;
	open.wrap.removeClass("is-open");
	open.menu.hide();
}

/** Grow the textarea with its content, up to a cap. */
function autoGrow(input: HTMLTextAreaElement): void {
	input.style.height = "auto";
	input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
}
