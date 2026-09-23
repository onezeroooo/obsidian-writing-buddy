/**
 * Optional, writer-owned instructions shared by every request in a Vault.
 *
 * The file is deliberately not seeded: reading this store on a clean install
 * must not create project data. Its Markdown body is only an additive input to
 * instruction composition; frontmatter is never returned as executable text
 * and cannot assign itself a role, priority, or policy level.
 */

import { projectPaths } from "../storage/paths";

/** The fixed file under the current project root. Read live: the root can move. */
export function projectInstructionsPath(): string {
	return projectPaths.projectInstructionsFile;
}

/** The narrow Vault capability needed by project instructions. */
export interface ProjectInstructionsStorage {
	exists(path: string): Promise<boolean>;
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	remove(path: string): Promise<void>;
}

export type ProjectInstructionsStatus = "absent" | "active" | "invalid";

/** A safe snapshot for both Settings and request composition. */
export interface ProjectInstructionsState {
	text: string;
	status: ProjectInstructionsStatus;
	error?: string;
	path: string;
}

type ParsedInstructions =
	| { ok: true; text: string }
	| { ok: false; error: string };

const FRONTMATTER = /^\s*---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u;
const FRONTMATTER_OPEN = /^\s*---[ \t]*(?:\r?\n|$)/u;
const CREDENTIAL_KEY_PATTERN =
	/(?:token|secret|password|passphrase|credential|api[._ -]*key|private[._ -]*key|access[._ -]*key|client[._ -]*secret|authorization|bearer|cookie|session[._ -]*id|ssh|executable|bin[._ -]*path|device[._ -]*id)/iu;

/**
 * Read, explicitly save, or clear the optional project customization file.
 *
 * Storage is injected so this module neither creates the WritingBuddy layout
 * nor couples request composition to ProjectStore. The adapter used at runtime
 * is responsible for making the fixed path's parent directory available when
 * `write` is explicitly called.
 */
export class ProjectInstructions {
	constructor(private readonly storage: ProjectInstructionsStorage) {}

	/** Read defensively. Missing, blank, malformed, and unreadable files do not throw. */
	async load(): Promise<ProjectInstructionsState> {
		try {
			if (!(await this.storage.exists(projectInstructionsPath()))) {
				return absentState();
			}

			const source: unknown = await this.storage.read(projectInstructionsPath());
			if (typeof source !== "string") {
				return invalidState("Project instructions must be stored as text.");
			}

			return stateFromSource(source);
		} catch (error) {
			return invalidState(`Could not read project instructions: ${errorMessage(error)}`);
		}
	}

	/** A lightweight status check with the same non-creating behavior as `load`. */
	async status(): Promise<ProjectInstructionsStatus> {
		return (await this.load()).status;
	}

	/**
	 * Persist an explicit writer edit. Unsafe or malformed frontmatter is rejected
	 * before the existing file is touched. The returned text is the effective
	 * Markdown body, never frontmatter.
	 */
	async save(source: string): Promise<ProjectInstructionsState> {
		const parsed = parseSource(source);
		if (!parsed.ok) return invalidState(parsed.error);

		try {
			await this.storage.write(projectInstructionsPath(), source);
			return activeOrAbsentState(parsed.text);
		} catch (error) {
			return invalidState(`Could not save project instructions: ${errorMessage(error)}`);
		}
	}

	/** Remove the customization if present. Clearing an absent file is a no-op. */
	async clear(): Promise<ProjectInstructionsState> {
		try {
			if (await this.storage.exists(projectInstructionsPath())) {
				await this.storage.remove(projectInstructionsPath());
			}
			return absentState();
		} catch (error) {
			return invalidState(`Could not clear project instructions: ${errorMessage(error)}`);
		}
	}
}

function stateFromSource(source: string): ProjectInstructionsState {
	const parsed = parseSource(source);
	return parsed.ok ? activeOrAbsentState(parsed.text) : invalidState(parsed.error);
}

function parseSource(source: string): ParsedInstructions {
	const text = source.replace(/^\uFEFF/u, "");
	const match = FRONTMATTER.exec(text);

	if (!match) {
		if (FRONTMATTER_OPEN.test(text)) {
			return { ok: false, error: "Project instructions have an unterminated frontmatter block." };
		}
		return { ok: true, text: text.trim() };
	}

	const forbiddenKeys = findCredentialLookingKeys(match[1]);
	if (forbiddenKeys.length > 0) {
		return {
			ok: false,
			error: `Project instructions frontmatter contains forbidden credential-looking key(s): ${forbiddenKeys.join(", ")}.`,
		};
	}

	return { ok: true, text: text.slice(match[0].length).trim() };
}

function findCredentialLookingKeys(frontmatter: string): string[] {
	const keys = new Set<string>();
	for (const rawLine of frontmatter.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;

		const match = /^(?:-\s*)?(?:"([^"]+)"|'([^']+)'|([^:#][^:]*?))\s*:/u.exec(line);
		const key = (match?.[1] ?? match?.[2] ?? match?.[3])?.trim();
		if (key && CREDENTIAL_KEY_PATTERN.test(key)) keys.add(key);
	}
	return [...keys];
}

function activeOrAbsentState(text: string): ProjectInstructionsState {
	return text.length > 0
		? { text, status: "active", path: projectInstructionsPath() }
		: absentState();
}

function absentState(): ProjectInstructionsState {
	return { text: "", status: "absent", path: projectInstructionsPath() };
}

function invalidState(error: string): ProjectInstructionsState {
	return { text: "", status: "invalid", error, path: projectInstructionsPath() };
}

function errorMessage(error: unknown): string {
	return error instanceof Error && error.message ? error.message : "unknown storage error";
}
