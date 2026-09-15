/**
 * Skill files are Markdown with a small YAML-ish frontmatter block.
 *
 * The format is deliberately tiny — flat `key: value` pairs — because writers
 * are meant to author these by hand in Obsidian. A full YAML parser would add a
 * dependency and a surface area that nothing here needs. Anything the parser
 * does not recognise is ignored rather than treated as an error, so a skill
 * file annotated with extra keys still loads.
 */

import type { Skill, SkillAction, SkillScope } from "../types";

export type SkillCustomizationMode = "extend" | "replace";

export interface SkillFileMetadata {
	schemaVersion?: number;
	mode?: SkillCustomizationMode;
	baseVersion?: number;
	baseHash?: string;
}

export type SkillParseResult =
	| { ok: true; skill: Skill; metadata: SkillFileMetadata }
	| { ok: false; reason: string };

const ACTIONS: readonly SkillAction[] = ["chat", "rewrite", "continue"];
const SCOPES: readonly SkillScope[] = ["selection", "current-document", "project"];

/** Keys owned by the structured Skill editor and serializer. */
export const KNOWN_SKILL_FRONTMATTER_KEYS = new Set([
	"schemaversion", "id", "name", "action", "scope", "version", "description",
	"composerprompt", "instructionprofile", "routing", "routingallowquestions", "triggers",
	"mode", "baseversion", "basehash",
]);

/** Split a document into its frontmatter block and its body. */
export function splitFrontmatter(source: string): { frontmatter: string | null; body: string } {
	// Tolerate a UTF-8 BOM and leading blank lines before the opening fence.
	const text = source.replace(/^﻿/, "");
	const match = /^\s*---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
	if (!match) return { frontmatter: null, body: text };
	return { frontmatter: match[1], body: text.slice(match[0].length) };
}

/** Parse flat `key: value` lines. Later duplicates win. */
export function parseFrontmatter(block: string): Map<string, string> {
	const values = new Map<string, string>();
	for (const rawLine of block.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) continue;
		const separator = line.indexOf(":");
		if (separator <= 0) continue;
		const key = line.slice(0, separator).trim().toLowerCase();
		let value = line.slice(separator + 1).trim();
		// Strip one matching layer of quotes, so CJK values can be quoted or not.
		if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
			value = value.slice(1, -1);
		}
		values.set(key, value);
	}
	return values;
}

/**
 * Parse one skill file.
 *
 * `sourcePath` is used both for the skill's recorded origin and as the fallback
 * id, so a file with no explicit `id` still loads under its filename.
 */
export function parseSkill(source: string, sourcePath?: string): SkillParseResult {
	const { frontmatter, body } = splitFrontmatter(source);
	if (frontmatter === null) {
		return { ok: false, reason: "missing frontmatter block" };
	}

	const fields = parseFrontmatter(frontmatter);
	const schemaVersionRaw = fields.get("schemaversion");
	const schemaVersion = positiveInteger(schemaVersionRaw);
	if (schemaVersionRaw !== undefined && schemaVersion === undefined) {
		return { ok: false, reason: `invalid \`schemaVersion\`: ${schemaVersionRaw}` };
	}
	if (schemaVersion !== undefined && schemaVersion !== 1) {
		return { ok: false, reason: `unsupported \`schemaVersion\`: ${String(schemaVersion)}` };
	}

	const fallbackId = sourcePath ? fileStem(sourcePath) : undefined;
	const id = fields.get("id") || fallbackId;
	if (!id) return { ok: false, reason: "missing `id`" };
	if (!/^[\w-]+$/.test(id)) {
		return { ok: false, reason: `invalid \`id\`: ${id}` };
	}

	const action = fields.get("action");
	if (!action) return { ok: false, reason: "missing `action`" };
	if (!ACTIONS.includes(action as SkillAction)) {
		return { ok: false, reason: `unknown \`action\`: ${action} (expected ${ACTIONS.join(", ")})` };
	}

	const scope = fields.get("scope") ?? "selection";
	if (!SCOPES.includes(scope as SkillScope)) {
		return { ok: false, reason: `unknown \`scope\`: ${scope} (expected ${SCOPES.join(", ")})` };
	}

	const instruction = body.trim();
	if (instruction.length === 0) {
		return { ok: false, reason: "skill body is empty" };
	}

	const versionRaw = fields.get("version");
	const version = versionRaw !== undefined ? Number.parseInt(versionRaw, 10) : 1;

	const skill: Skill = {
		id,
		name: fields.get("name") || id,
		action: action as SkillAction,
		scope: scope as SkillScope,
		version: Number.isFinite(version) && version > 0 ? version : 1,
		instruction,
		builtin: false,
	};

	const description = fields.get("description");
	if (description) skill.description = description;

	const composerPrompt = fields.get("composerprompt");
	if (composerPrompt) skill.composerPrompt = composerPrompt;

	const instructionProfile = fields.get("instructionprofile");
	if (instructionProfile) {
		if (instructionProfile !== "review") {
			return { ok: false, reason: `unknown \`instructionProfile\`: ${instructionProfile}` };
		}
		skill.instructionProfile = instructionProfile;
	}

	// Separated by any of the punctuation a writer would reach for, so the
	// frontmatter stays flat `key: value` and needs no list syntax.
	const triggers = (fields.get("triggers") ?? "")
		.split(/[、,，;；|]/)
		.map((trigger) => trigger.trim())
		.filter((trigger) => trigger.length > 0);
	if (triggers.length > 0) skill.triggers = triggers;

	const routingPhrases = splitPhrases(fields.get("routing") ?? "");
	const routedBy = routingPhrases.length > 0 ? routingPhrases : triggers;
	if (routedBy.length > 0) {
		const allowQuestionsRaw = fields.get("routingallowquestions");
		const allowQuestions = parseBoolean(allowQuestionsRaw);
		if (allowQuestionsRaw !== undefined && allowQuestions === undefined) {
			return { ok: false, reason: `invalid \`routingAllowQuestions\`: ${allowQuestionsRaw}` };
		}
		skill.routing = {
			phrases: routedBy,
			...(allowQuestions !== undefined ? { allowQuestions } : {}),
		};
	}

	if (sourcePath) skill.sourcePath = sourcePath;

	const mode = fields.get("mode");
	if (mode !== undefined && mode !== "extend" && mode !== "replace") {
		return { ok: false, reason: `unknown \`mode\`: ${mode} (expected extend, replace)` };
	}
	const baseVersionRaw = fields.get("baseversion");
	const baseVersion = positiveInteger(baseVersionRaw);
	if (baseVersionRaw !== undefined && baseVersion === undefined) {
		return { ok: false, reason: `invalid \`baseVersion\`: ${baseVersionRaw}` };
	}
	const baseHash = fields.get("basehash");
	if (baseHash !== undefined && !/^[a-f0-9]{64}$/iu.test(baseHash)) {
		return { ok: false, reason: "invalid `baseHash` (expected a SHA-256 hash)" };
	}

	return {
		ok: true,
		skill,
		metadata: {
			...(schemaVersion !== undefined ? { schemaVersion } : {}),
			...(mode !== undefined ? { mode } : {}),
			...(baseVersion !== undefined ? { baseVersion } : {}),
			...(baseHash !== undefined ? { baseHash: baseHash.toLowerCase() } : {}),
		},
	};
}

/** Render a skill back to its Markdown form. */
export function serializeSkill(skill: Skill, metadata: SkillFileMetadata = {}): string {
	const lines = [
		"---",
		...(metadata.schemaVersion !== undefined ? [`schemaVersion: ${metadata.schemaVersion}`] : []),
		`id: ${skill.id}`,
		`name: ${skill.name}`,
		`action: ${skill.action}`,
		`scope: ${skill.scope}`,
		`version: ${skill.version}`,
	];
	if (skill.description) lines.push(`description: ${skill.description}`);
	if (skill.composerPrompt) lines.push(`composerPrompt: ${skill.composerPrompt}`);
	if (skill.instructionProfile) lines.push(`instructionProfile: ${skill.instructionProfile}`);
	if (skill.routing && skill.routing.phrases.length > 0) {
		lines.push(`routing: ${skill.routing.phrases.join("、")}`);
		if (skill.routing.allowQuestions !== undefined) {
			lines.push(`routingAllowQuestions: ${String(skill.routing.allowQuestions)}`);
		}
	}
	if (skill.triggers && skill.triggers.length > 0) {
		lines.push(`triggers: ${skill.triggers.join("、")}`);
	}
	if (metadata.mode) lines.push(`mode: ${metadata.mode}`);
	if (metadata.baseVersion !== undefined) lines.push(`baseVersion: ${metadata.baseVersion}`);
	if (metadata.baseHash) lines.push(`baseHash: ${metadata.baseHash}`);
	lines.push("---", "", skill.instruction, "");
	return lines.join("\n");
}

/**
 * Keep writer-owned unknown metadata and frontmatter comments when the focused
 * Settings form rewrites fields it understands. Known fields come exclusively
 * from `nextSource`; unknown/comment lines from the existing file are carried
 * forward verbatim so using the UI is not a lossy format conversion.
 */
export function preserveUnknownSkillFrontmatter(existingSource: string, nextSource: string): string {
	const existing = splitFrontmatter(existingSource);
	if (existing.frontmatter === null) return nextSource;
	const retained = existing.frontmatter.split(/\r?\n/u).filter((rawLine) => {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) return true;
		const separator = rawLine.indexOf(":");
		if (separator <= 0) return true;
		return !KNOWN_SKILL_FRONTMATTER_KEYS.has(rawLine.slice(0, separator).trim().toLowerCase());
	});
	if (retained.every((line) => line.trim().length === 0)) return nextSource;
	return nextSource.replace(/^---\n/u, `---\n${retained.join("\n")}\n`);
}

function splitPhrases(value: string): string[] {
	return value
		.split(/[、,，;；|]/)
		.map((phrase) => phrase.trim())
		.filter((phrase) => phrase.length > 0);
}

function positiveInteger(value: string | undefined): number | undefined {
	if (value === undefined) return undefined;
	const parsed = Number(value);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseBoolean(value: string | undefined): boolean | undefined {
	if (value === undefined) return undefined;
	if (value.toLowerCase() === "true") return true;
	if (value.toLowerCase() === "false") return false;
	return undefined;
}

function fileStem(path: string): string {
	const name = path.split("/").pop() ?? path;
	return name.replace(/\.md$/i, "");
}
