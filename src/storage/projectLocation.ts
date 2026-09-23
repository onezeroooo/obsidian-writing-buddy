/**
 * Where the project root is, as recorded in the plugin's own `data.json`.
 *
 * This is the one project-level fact that cannot live inside the project
 * root: it is the pointer *to* the root. It is also the one setting that must
 * travel with the vault rather than the device (unlike everything in
 * `DeviceStore`), because the folder it points at travels with the vault — a
 * second device that read a per-machine default would look in the wrong
 * place, find nothing, and create an empty root beside the real data. Plugin
 * `data.json` is what Obsidian syncs for exactly this kind of setting.
 *
 * Nothing else goes in `data.json`. Credentials and per-device state stay in
 * `DeviceStore`; project metadata stays in `project.json`.
 */

import {
	DEFAULT_PROJECT_ROOT,
	PROJECT_FILE_NAME,
	checkProjectRoot,
	type VaultFs,
} from "./paths";

export const PLUGIN_DATA_SCHEMA_VERSION = 1;

/** The recorded location, and whether anyone recorded it. */
export interface ProjectLocation {
	root: string;
	/**
	 * True when `data.json` names a root. False for the default with nothing
	 * on record — a fresh vault, or a vault from before roots were movable.
	 * The distinction decides what an absent folder means at startup: a
	 * recorded root that is missing was moved or is still syncing, and must
	 * not be recreated; an unrecorded default that is missing is a new vault.
	 */
	explicit: boolean;
}

/**
 * Read the location out of whatever `loadData()` returned.
 *
 * Tolerant on purpose (PC-014): a missing file, an older shape, or a value
 * that fails today's checks all resolve to the default rather than blocking
 * the plugin. A recorded root that no longer validates — say a later build
 * tightens the rules — is reported as the default and *not* explicit, so the
 * startup path treats the vault as it would any other with no record.
 */
export function readProjectLocation(raw: unknown, options: { configDir?: string | null } = {}): ProjectLocation {
	if (!raw || typeof raw !== "object") return { root: DEFAULT_PROJECT_ROOT, explicit: false };
	const recorded = (raw as Record<string, unknown>).projectRoot;
	if (typeof recorded !== "string") return { root: DEFAULT_PROJECT_ROOT, explicit: false };
	const check = checkProjectRoot(recorded, options);
	if (!check.ok) return { root: DEFAULT_PROJECT_ROOT, explicit: false };
	return { root: check.root, explicit: true };
}

/**
 * The object to hand to `saveData()`.
 *
 * Merges into whatever is already there so a field a newer build added is
 * carried rather than dropped by an older one running beside it. The default
 * root is recorded explicitly once the writer has been through a move, since
 * "back at the default" and "never moved" are different histories.
 */
export function writeProjectLocation(raw: unknown, root: string): Record<string, unknown> {
	const existing = raw && typeof raw === "object" ? { ...(raw as Record<string, unknown>) } : {};
	return { ...existing, schemaVersion: PLUGIN_DATA_SCHEMA_VERSION, projectRoot: root };
}

/** A folder in the vault that looks like one of ours. */
export interface ProjectRootCandidate {
	root: string;
	/** Conversation manifests directly under `conversations/`. */
	conversations: number;
	/** The newest modification time seen in the folder, when the adapter reports one. */
	updatedAt: number | null;
}

/** The manifest path for a folder, for callers that scan by file name. */
export function projectFileIn(root: string): string {
	return `${root}/${PROJECT_FILE_NAME}`;
}

/** The folder a manifest path belongs to, or `null` when it is not one. */
export function rootOfProjectFile(path: string): string | null {
	const suffix = `/${PROJECT_FILE_NAME}`;
	if (path === PROJECT_FILE_NAME) return null;
	if (!path.endsWith(suffix)) return null;
	return path.slice(0, -suffix.length);
}

/**
 * Keep, from folders the caller found a `project.json` in, the ones that hold
 * project data of ours, and say how much.
 *
 * A `project.json` is not a rare filename — a code project kept in the vault
 * has one too — so the manifest is parsed and must carry our schema before
 * the folder is offered to the writer. Counting conversations is what lets
 * the writer tell a real root from an empty one they created by mistake.
 */
export async function describeProjectRootCandidates(
	fs: VaultFs,
	roots: readonly string[],
	options: { configDir?: string | null } = {},
): Promise<ProjectRootCandidate[]> {
	const candidates: ProjectRootCandidate[] = [];
	for (const root of roots) {
		if (!checkProjectRoot(root, options).ok) continue;
		if (!(await looksLikeProjectManifest(fs, projectFileIn(root)))) continue;
		let conversations = 0;
		let updatedAt = await modifiedAt(fs, projectFileIn(root));
		const conversationsDir = `${root}/conversations`;
		try {
			if (await fs.exists(conversationsDir)) {
				const listed = await fs.list(conversationsDir);
				const manifests = listed.files.filter((file) => file.toLowerCase().endsWith(".json"));
				conversations = manifests.length;
				for (const manifest of manifests) {
					const stamp = await modifiedAt(fs, manifest);
					if (stamp !== null && (updatedAt === null || stamp > updatedAt)) updatedAt = stamp;
				}
			}
		} catch {
			// An unreadable conversations folder still leaves a real root; it is
			// offered with what could be counted.
		}
		candidates.push({ root, conversations, updatedAt });
	}
	return candidates.sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0) || left.root.localeCompare(right.root));
}

async function looksLikeProjectManifest(fs: VaultFs, path: string): Promise<boolean> {
	try {
		if (!(await fs.exists(path))) return false;
		const decoded: unknown = JSON.parse(await fs.read(path));
		if (!decoded || typeof decoded !== "object") return false;
		const record = decoded as Record<string, unknown>;
		return typeof record.schemaVersion === "number" && typeof record.displayName === "string";
	} catch {
		return false;
	}
}

async function modifiedAt(fs: VaultFs, path: string): Promise<number | null> {
	if (typeof fs.stat !== "function") return null;
	try {
		return (await fs.stat(path))?.mtime ?? null;
	} catch {
		return null;
	}
}
