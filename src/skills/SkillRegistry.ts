/** Ownership-aware resolution of immutable built-ins and writer-owned Skills. */

import type { Skill } from "../types";
import type { ProjectStore, StoredSkillFile } from "../storage/ProjectStore";
import { CUSTOM_SKILLS_DIR, SKILL_OVERRIDES_DIR } from "../storage/paths";
import { BUILTIN_SKILLS, localizeBuiltinSkill, resolveRetiredBuiltinSkillId } from "./builtinSkills";
import { hashSkillSource } from "./skillCatalog";
import { markLegacyCustomizationsReset, migrateLegacySkillFiles, type RemovedSkillDestination } from "./skillMigration";
import { parseSkill, preserveUnknownSkillFrontmatter, serializeSkill, type SkillCustomizationMode } from "./skillParser";
import { mapWithConcurrency } from "../util/pool";

export type SkillOwnership = "builtin" | "custom" | "customized-builtin";
export type SkillStatus = "active" | "needs-review" | "conflicted" | "invalid";

export interface EffectiveSkill extends Skill {
	ownership: SkillOwnership;
	status: SkillStatus;
	customized: boolean;
	contentHash: string;
	builtinVersion?: number;
	/** Hash of the currently packaged built-in base, when this id has one. */
	builtinHash?: string;
	/** Hash of the base against which this customization was authored. */
	baseHash?: string;
	customizationPath?: string;
	customizationMode?: SkillCustomizationMode;
}

export type RegisteredSkill = EffectiveSkill;

export interface SkillDescriptor {
	skill: EffectiveSkill;
	id: string;
	name: string;
	ownership: SkillOwnership;
	status: SkillStatus;
	customized: boolean;
	builtinVersion?: number;
	builtinHash?: string;
	contentHash: string;
	baseHash?: string;
	customizationPath?: string;
	customizationMode?: SkillCustomizationMode;
}

export interface SkillLoadProblem {
	path: string;
	reason: string;
}

export interface SkillLoadReport {
	skills: EffectiveSkill[];
	problems: SkillLoadProblem[];
}

interface LoadedFile {
	file: StoredSkillFile;
	source: string;
	skill: Skill;
	mode: SkillCustomizationMode;
	baseHash?: string;
}

export class SkillRegistry {
	private skills: EffectiveSkill[] = BUILTIN_SKILLS.map(effectiveBuiltin);
	private skillDescriptors: SkillDescriptor[] = this.skills.map(descriptorFor);
	private problems: SkillLoadProblem[] = [];
	/** Last valid parse by path, retained through partial LiveSync writes. */
	private readonly lastGood = new Map<string, LoadedFile>();

	constructor(private readonly store: ProjectStore) {}

	list(): EffectiveSkill[] {
		return [...this.skills];
	}

	descriptors(): SkillDescriptor[] {
		return [...this.skillDescriptors];
	}

	byAction(action: Skill["action"]): EffectiveSkill[] {
		return this.skills.filter((skill) => isRoutable(skill) && skill.action === action);
	}

	/**
	 * Resolve a Skill id, including one retired by a later release.
	 *
	 * A live Skill always wins. Only when no loaded Skill owns the id is the
	 * retirement map consulted, so a writer who defines their own Skill under a
	 * retired id keeps it, and stored turns naming a folded-away built-in still
	 * resolve to whatever replaced it instead of losing their Skill entirely.
	 */
	get(id: string): EffectiveSkill | undefined {
		const direct = this.skills.find((candidate) => candidate.id === id);
		if (direct) return isRoutable(direct) ? direct : undefined;
		const successor = resolveRetiredBuiltinSkillId(id);
		if (successor === undefined) return undefined;
		const replacement = this.skills.find((candidate) => candidate.id === successor);
		return replacement && isRoutable(replacement) ? replacement : undefined;
	}

	getProblems(): SkillLoadProblem[] {
		return [...this.problems];
	}

	builtinSource(id: string): string | null {
		const builtin = BUILTIN_SKILLS.find((candidate) => candidate.id === id);
		return builtin ? serializeSkill(builtin) : null;
	}

	async customizationSource(id: string): Promise<string | null> {
		const paths = await this.overridePathsFor(id);
		return paths.length === 1 ? this.store.readSkillFile(paths[0] ?? "") : null;
	}

	async saveBuiltinCustomization(id: string, extension: string): Promise<void> {
		const builtin = BUILTIN_SKILLS.find((candidate) => candidate.id === id);
		if (!builtin) throw new Error(`Unknown built-in skill: ${id}`);
		if (extension.trim().length === 0) throw new Error("Skill customization cannot be empty.");
		const baseHash = hashSkillSource(serializeSkill(builtin));
		// Persist only the writer's delta. Release-owned labels, routing and other
		// metadata continue to update with the packaged base.
		const skill: Skill = {
			id: builtin.id,
			name: builtin.id,
			action: builtin.action,
			scope: builtin.scope,
			version: 1,
			instruction: extension.trim(),
			builtin: false,
		};
		const paths = await this.overridePathsFor(id);
		if (paths.length > 1) throw new Error(`Cannot save conflicted customization for ${id}.`);
		const path = paths[0] ?? `${SKILL_OVERRIDES_DIR}/${id}.md`;
		if (paths.length === 0 && await this.store.fileExists(path)) {
			throw new Error(`Refusing to overwrite unrelated skill file: ${path}`);
		}
		const existing = paths.length === 1 ? await this.store.readSkillFile(path) : null;
		if (existing !== null) {
			const parsed = parseSkill(existing, path);
			if (!parsed.ok) throw new Error(parsed.reason);
			if (parsed.metadata.mode === "replace") {
				throw new Error(`Skill ${id} is a legacy replacement; use replacement editing.`);
			}
		}
		const serialized = serializeSkill(
			skill, { schemaVersion: 1, mode: "extend", baseVersion: builtin.version, baseHash },
		);
		await this.store.writeSkillFile(
			path,
			existing === null ? serialized : preserveUnknownSkillFrontmatter(existing, serialized),
		);
		await this.reload();
	}

	/**
	 * Replace the body of an already-migrated full replacement without changing
	 * its ownership mode. A legacy replacement is not an additive extension: if
	 * Settings silently converted it, the current built-in and the complete old
	 * prompt would both run. Only the body is editable here; the replacement's
	 * captured task metadata and base review state remain intact.
	 */
	async saveBuiltinReplacement(id: string, instruction: string): Promise<void> {
		if (instruction.trim().length === 0) throw new Error("Skill customization cannot be empty.");
		const paths = await this.overridePathsFor(id);
		if (paths.length !== 1) throw new Error(`Cannot save conflicted customization for ${id}.`);
		const path = paths[0] ?? "";
		const source = await this.store.readSkillFile(path);
		const parsed = parseSkill(source, path);
		if (!parsed.ok || parsed.skill.id !== id || parsed.metadata.mode !== "replace") {
			throw new Error(`Skill ${id} is not a legacy replacement.`);
		}
		const next = serializeSkill(
			{ ...parsed.skill, instruction: instruction.trim() },
			{ ...parsed.metadata, schemaVersion: parsed.metadata.schemaVersion ?? 1, mode: "replace" },
		);
		await this.store.writeSkillFile(path, preserveUnknownSkillFrontmatter(source, next));
		await this.reload();
	}

	async resetBuiltinCustomization(id: string): Promise<void> {
		if (!BUILTIN_SKILLS.some((candidate) => candidate.id === id)) return;
		const files = await this.store.listStoredSkillFiles({ includeLegacy: false });
		const matches: Array<{ path: string; source: string }> = [];
		for (const file of files.filter((candidate) => candidate.location === "override")) {
			try {
				const source = await this.store.readSkillFile(file.path);
				const parsed = parseSkill(source, file.path);
				if (parsed.ok && parsed.skill.id === id) matches.push({ path: file.path, source });
			} catch {
				// A malformed unrelated file is reported by reload and never deleted.
			}
		}
		if (matches.length > 1) {
			throw new Error(`Cannot reset conflicted customization for ${id}; resolve duplicate files first.`);
		}
		const removed: RemovedSkillDestination[] = [];
		for (const match of matches) {
			await this.store.removeSkillFile(match.path);
			removed.push({ path: match.path, hash: hashSkillSource(match.source) });
		}
		await markLegacyCustomizationsReset(this.store, removed);
		await this.reload();
	}

	async saveCustomSkill(source: string, existingPath?: string): Promise<void> {
		const parsed = parseSkill(source, existingPath);
		if (!parsed.ok) throw new Error(parsed.reason);
		if (BUILTIN_SKILLS.some((candidate) => candidate.id === parsed.skill.id)) {
			throw new Error(`Custom skill id conflicts with built-in: ${parsed.skill.id}`);
		}
		const path = existingPath ?? `${CUSTOM_SKILLS_DIR}/${parsed.skill.id}.md`;
		if (!path.startsWith(`${CUSTOM_SKILLS_DIR}/`) || !path.toLowerCase().endsWith(".md")) {
			throw new Error("Custom skills must be stored under WritingBuddy/skills/custom/.");
		}
		if (existingPath === undefined) {
			const files = await this.store.listStoredSkillFiles({ includeLegacy: false });
			for (const file of files) {
				try {
					const existing = parseSkill(await this.store.readSkillFile(file.path), file.path);
					if (existing.ok && existing.skill.id === parsed.skill.id) {
						throw new Error(`Skill id already exists: ${parsed.skill.id}`);
					}
				} catch (error) {
					if ((error as Error).message.startsWith("Skill id already exists:")) throw error;
				}
			}
			if (await this.store.fileExists(path)) {
				throw new Error(`Refusing to overwrite existing skill file: ${path}`);
			}
		}
		const nextSource = existingPath
			? preserveUnknownSkillFrontmatter(await this.store.readSkillFile(existingPath), source)
			: source;
		await this.store.writeSkillFile(path, nextSource);
		await this.reload();
	}

	async reload(): Promise<SkillLoadReport> {
		await this.store.ensureLayout();
		const allFiles = await this.store.listStoredSkillFiles();
		const migration = await migrateLegacySkillFiles(
			this.store,
			allFiles.filter((file) => file.location === "legacy"),
		);
		const files = await this.store.listStoredSkillFiles({ includeLegacy: false });
		const problems: SkillLoadProblem[] = [...migration.problems];

		const reads = await mapWithConcurrency(files, async (file) => {
			try {
				return { file, source: await this.store.readSkillFile(file.path) };
			} catch (error) {
				return { file, reason: (error as Error).message };
			}
		});

		const valid: LoadedFile[] = [];
		const currentPaths = new Set(files.map((file) => file.path));
		for (const path of [...this.lastGood.keys()]) {
			if (!currentPaths.has(path)) this.lastGood.delete(path);
		}
		for (const entry of reads) {
			if (!("source" in entry) || entry.source === undefined) {
				problems.push({ path: entry.file.path, reason: (entry as { reason: string }).reason });
				const cached = this.lastGood.get(entry.file.path);
				if (cached) valid.push(cached);
				continue;
			}
			const parsed = parseSkill(entry.source, entry.file.path);
			if (!parsed.ok) {
				problems.push({ path: entry.file.path, reason: parsed.reason });
				const cached = this.lastGood.get(entry.file.path);
				if (cached) valid.push(cached);
				continue;
			}
			const loaded: LoadedFile = {
				file: entry.file,
				source: entry.source,
				skill: parsed.skill,
				mode: parsed.metadata.mode ?? "extend",
				...(parsed.metadata.baseHash ? { baseHash: parsed.metadata.baseHash } : {}),
			};
			this.lastGood.set(entry.file.path, loaded);
			valid.push(loaded);
		}

		const builtinById = new Map(BUILTIN_SKILLS.map((skill) => [skill.id, skill]));
		const candidates = new Map<string, LoadedFile[]>();
		for (const loaded of valid) {
			const expected = loaded.file.location === "override" ? builtinById.has(loaded.skill.id) : !builtinById.has(loaded.skill.id);
			if (!expected) {
				problems.push({
					path: loaded.file.path,
					reason: loaded.file.location === "override"
						? `override targets unknown built-in \`${loaded.skill.id}\``
						: `custom skill id conflicts with built-in \`${loaded.skill.id}\``,
				});
				continue;
			}
			const group = candidates.get(loaded.skill.id) ?? [];
			group.push(loaded);
			candidates.set(loaded.skill.id, group);
		}

		const byId = new Map<string, EffectiveSkill>();
		const conflicts = new Map<string, EffectiveSkill>();
		for (const builtin of BUILTIN_SKILLS) byId.set(builtin.id, effectiveBuiltin(builtin));
		for (const [id, group] of [...candidates].sort(([left], [right]) => left.localeCompare(right))) {
			group.sort((left, right) => left.file.path.localeCompare(right.file.path));
			if (group.length > 1) {
				const paths = group.map((entry) => entry.file.path).join(", ");
				for (const entry of group) problems.push({ path: entry.file.path, reason: `duplicate skill id \`${id}\`: ${paths}` });
				const first = group[0];
				const builtin = builtinById.get(id);
				if (first) {
					const conflict = builtin ? customizedBuiltin(builtin, first) : effectiveCustom(first);
					conflicts.set(id, { ...conflict, status: "conflicted" });
				}
				continue;
			}
			const loaded = group[0];
			if (!loaded) continue;
			const builtin = builtinById.get(id);
			byId.set(id, builtin ? customizedBuiltin(builtin, loaded) : effectiveCustom(loaded));
		}

		const ordered: EffectiveSkill[] = [];
		for (const builtin of BUILTIN_SKILLS) {
			const resolved = byId.get(builtin.id);
			if (resolved) { ordered.push(resolved); byId.delete(builtin.id); }
		}
		ordered.push(...[...byId.values()].sort((left, right) => left.name.localeCompare(right.name, "zh")));

		this.skills = ordered;
		this.skillDescriptors = [
			...ordered.filter((skill) => !conflicts.has(skill.id)).map(descriptorFor),
			...[...conflicts.values()].sort((left, right) => left.id.localeCompare(right.id)).map(descriptorFor),
		];
		this.problems = problems;
		return { skills: this.list(), problems };
	}

	private async overridePathsFor(id: string): Promise<string[]> {
		const files = await this.store.listStoredSkillFiles({ includeLegacy: false });
		const matches: string[] = [];
		for (const file of files.filter((candidate) => candidate.location === "override")) {
			try {
				const parsed = parseSkill(await this.store.readSkillFile(file.path), file.path);
				if (parsed.ok && parsed.skill.id === id) matches.push(file.path);
			} catch {
				// Reload reports malformed files; management never guesses their owner.
			}
		}
		return matches.sort((left, right) => left.localeCompare(right));
	}
}

function effectiveBuiltin(skill: Skill): EffectiveSkill {
	// Served in the project's instruction language; hashed from the canonical
	// Chinese skill so fingerprints and customization bases never move.
	const canonicalHash = hashSkillSource(serializeSkill(skill));
	return {
		...localizeBuiltinSkill(skill),
		builtin: true,
		ownership: "builtin",
		status: "active",
		customized: false,
		builtinVersion: skill.version,
		builtinHash: canonicalHash,
		contentHash: canonicalHash,
	};
}

function effectiveCustom(loaded: LoadedFile): EffectiveSkill {
	return {
		...loaded.skill,
		builtin: false,
		ownership: "custom",
		status: "active",
		customized: false,
		contentHash: hashSkillSource(loaded.source),
		customizationPath: loaded.file.path,
	};
}

function customizedBuiltin(builtin: Skill, loaded: LoadedFile): EffectiveSkill {
	const builtinHash = hashSkillSource(serializeSkill(builtin));
	const extension = loaded.skill.instruction.trim();
	// The writer's delta merges onto the base as served in the instruction
	// language, while the identity hash below stays canonical.
	const mergeOnto = (base: Skill): Skill => ({
		...base,
		// Metadata supplied by the customization is additive too: omitted
		// fields keep the release-owned base value.
		...(loaded.skill.name !== loaded.skill.id ? { name: loaded.skill.name } : {}),
		...(loaded.skill.description ? { description: loaded.skill.description } : {}),
		...(loaded.skill.composerPrompt ? { composerPrompt: loaded.skill.composerPrompt } : {}),
		...(loaded.skill.routing ? { routing: loaded.skill.routing, triggers: loaded.skill.triggers } : {}),
		instruction: [base.instruction.trim(), extension].filter(Boolean).join("\n\n"),
	});
	const canonicalMerged: Skill = loaded.mode === "replace" ? { ...loaded.skill } : mergeOnto(builtin);
	const merged: Skill = loaded.mode === "replace" ? { ...loaded.skill } : mergeOnto(localizeBuiltinSkill(builtin));
	return {
		...merged,
		builtin: false,
		sourcePath: loaded.file.path,
		ownership: "customized-builtin",
		status: loaded.mode === "replace" && loaded.baseHash !== builtinHash ? "needs-review" : "active",
		customized: true,
		builtinVersion: builtin.version,
		builtinHash,
		baseHash: loaded.baseHash,
		contentHash: hashSkillSource(serializeSkill(canonicalMerged)),
		customizationPath: loaded.file.path,
		customizationMode: loaded.mode,
	};
}

function descriptorFor(skill: EffectiveSkill): SkillDescriptor {
	return {
		skill, id: skill.id, name: skill.name, ownership: skill.ownership, status: skill.status,
		customized: skill.customized, contentHash: skill.contentHash,
		...(skill.builtinVersion !== undefined ? { builtinVersion: skill.builtinVersion } : {}),
		...(skill.builtinHash ? { builtinHash: skill.builtinHash } : {}),
		...(skill.baseHash ? { baseHash: skill.baseHash } : {}),
		...(skill.customizationPath ? { customizationPath: skill.customizationPath } : {}),
		...(skill.customizationMode ? { customizationMode: skill.customizationMode } : {}),
	};
}

function isRoutable(skill: EffectiveSkill): boolean {
	return skill.status === "active" || skill.status === "needs-review";
}
