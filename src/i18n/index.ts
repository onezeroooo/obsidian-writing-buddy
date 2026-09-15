/**
 * UI-string localization.
 *
 * The interface follows Obsidian's own UI language: a Chinese Obsidian shows
 * the plugin in Chinese, any other language shows it in English for now. The
 * plugin resolves that once at `onload`; until then, and whenever the
 * language cannot be read, the locale is English. A writer can still pin a
 * language for one device in Settings, which overrides the detection.
 *
 * Obsidian keeps its UI language in `localStorage` under `language`, absent
 * meaning English. That store is app-wide, not vault-scoped, which is what a
 * UI language should follow. (`getLanguage()` in newer typings reads the same
 * value; the raw read works on every Obsidian this plugin supports.)
 *
 * The test suite asserts against the Chinese source strings and pins the
 * locale in its setup file; nothing in the product relies on that.
 */
import { getLanguage } from "obsidian";
import { en } from "./en";
import { zh } from "./zh";

export type StringKey = keyof typeof zh;
export type Locale = "zh" | "en";
/** The device-level setting: a pinned language, or follow Obsidian. */
export type LocaleSetting = Locale | "auto";

const dictionaries: Record<Locale, Record<StringKey, string>> = { zh, en };

let current: Locale = "en";

export function setLocale(locale: Locale): void {
	current = locale;
}

export function getLocale(): Locale {
	return current;
}

/**
 * The second language axis: what the model is spoken to in.
 *
 * Stored with the project, so a manuscript keeps its language on every device.
 * By default it follows the interface language; a writer who wants Chinese
 * prompts on an English interface pins it in Settings. Consumers are the
 * prompt builders and the built-in skill instructions — never the UI
 * dictionary.
 */
let instruction: Locale = "en";

export function setInstructionLocale(locale: Locale): void {
	instruction = locale;
}

export function instructionLocale(): Locale {
	return instruction;
}

/** The instruction locale for a project setting: pinned wins, absent or `auto` follows the interface. */
export function resolveInstructionLocale(setting: LocaleSetting | undefined): Locale {
	if (setting === "zh" || setting === "en") return setting;
	return current;
}

/** The locale Obsidian's own UI is using. Anything unreadable or unknown is English. */
export function detectObsidianLocale(): Locale {
	try {
		return getLanguage().toLowerCase().startsWith("zh") ? "zh" : "en";
	} catch {
		return "en";
	}
}

/**
 * The UI locale for a device setting. A pinned language wins; absent or
 * `auto` follows Obsidian. This does not touch the instruction locale, which
 * belongs to the manuscript.
 */
export function resolveUiLocale(setting: LocaleSetting | undefined): Locale {
	if (setting === "zh" || setting === "en") return setting;
	return detectObsidianLocale();
}

/**
 * Look up a string and fill its `{name}` placeholders.
 *
 * A placeholder without a matching parameter is left visible rather than
 * erased: `{file}` on screen is a bug report; an empty gap is a mystery.
 */
export function t(key: StringKey, params?: Record<string, string | number>): string {
	const template = dictionaries[current][key];
	if (!params) return template;
	return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
		name in params ? String(params[name]) : whole,
	);
}
