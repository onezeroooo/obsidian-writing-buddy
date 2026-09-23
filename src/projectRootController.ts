/**
 * Where the project root is, and what to do when it moves.
 *
 * The folder is the writer's (see `storage/paths.ts`), so this controller
 * follows rather than dictates: a drag or rename in the file tree is adopted
 * on the spot, a rename of any ancestor folder is adopted the same way, and
 * the recorded location is what `data.json` carries to the writer's other
 * devices. Three rules keep every one of those moves reversible (D-047):
 *
 *   1. Nothing here deletes a folder.
 *   2. Nothing here moves data into a folder that already has contents.
 *   3. Nothing here creates a root on its own unless the vault has never had
 *      one. A root that is recorded but absent was moved, deleted or is still
 *      syncing — the plugin cannot tell which, so it stops writing and waits
 *      for either the folder to reappear or the writer to decide in Settings.
 *
 * The one thing the writer does not get to reshape is the inside of the
 * root. The fixed children (`PROJECT_STRUCTURE`) are put back where they
 * were if dragged out or renamed, with a notice saying to move the whole
 * folder instead — so the mistake never lands rather than being explained
 * afterwards.
 *
 * This file knows Obsidian; everything it decides with is in
 * `storage/paths.ts` and `storage/projectLocation.ts`, which do not.
 */

import { Notice, TFolder, type TAbstractFile } from "obsidian";
import type WritingBuddyPlugin from "./main";
import { t } from "./i18n";
import { setInactiveProjectRoots } from "./context/eligibility";
import {
	DEFAULT_PROJECT_ROOT,
	LEGACY_PROJECT_ROOTS,
	PROJECT_FILE_NAME,
	PROJECT_STRUCTURE,
	checkProjectRoot,
	isWithinRoot,
	projectPaths,
	relocatedPath,
	setProjectRoot,
	type ProjectRootProblem,
} from "./storage/paths";
import {
	describeProjectRootCandidates,
	projectFileIn,
	readProjectLocation,
	rootOfProjectFile,
	writeProjectLocation,
	type ProjectRootCandidate,
} from "./storage/projectLocation";
import type { VaultFs } from "./storage/paths";

export type ProjectRootState =
	| { kind: "loading" }
	| { kind: "ready" }
	| { kind: "missing"; candidates: ProjectRootCandidate[]; since: number };

/** Why Settings refused a target folder, beyond what `checkProjectRoot` says. */
export type RelocationProblem = ProjectRootProblem | "same" | "inside" | "occupied" | "busy";

export type RelocationCheck = { ok: true; root: string } | { ok: false; problem: RelocationProblem };

/** How long a recorded relocation stays known, so its child events are recognised. */
const RELOCATION_MEMORY_MS = 30_000;

export class ProjectRootController {
	state: ProjectRootState = { kind: "loading" };
	/** Roots in the vault that hold our data but are not the active one. */
	inactiveRoots: ProjectRootCandidate[] = [];
	/** Whether `data.json` names the root, or the default is in use unrecorded. */
	explicit = false;
	private lastMove: { from: string; to: string; at: number } | null = null;
	/**
	 * A structure change being put back. Its child events — the ones for the
	 * outbound move and the ones for the move back — describe nothing that
	 * changed, and must not be read as conversations leaving and returning.
	 */
	private lastRevert: { from: string; to: string; at: number } | null = null;
	/** Set while `relocate` runs, so the follow it triggers does not also announce itself. */
	private relocating = false;
	private missingCheck: number | null = null;
	/** The persistent "not found" notice, dismissed the moment the root is back. */
	private missingNotice: Notice | null = null;

	constructor(
		private readonly plugin: WritingBuddyPlugin,
		private readonly fs: VaultFs,
	) {}

	get root(): string {
		return projectPaths.root;
	}

	get isDefault(): boolean {
		return projectPaths.root === DEFAULT_PROJECT_ROOT;
	}

	// -------------------------------------------------------------------------
	// Startup
	// -------------------------------------------------------------------------

	/**
	 * Read the recorded location and decide whether the plugin may proceed.
	 *
	 * Returns `true` when project data can be loaded from the root as it now
	 * stands (existing, or a genuinely new vault). Returns `false` when the
	 * root is recorded but absent, or when there is no record and yet the
	 * vault already holds a root somewhere else — in both cases the plugin
	 * must not create a folder, and the writer is told where things stand.
	 */
	async resolveAtStartup(): Promise<boolean> {
		const location = readProjectLocation(await this.plugin.loadData(), { configDir: this.plugin.app.vault.configDir });
		setProjectRoot(location.root);
		this.explicit = location.explicit;
		this.plugin.projectStore.rootChanged();

		if (await this.fs.exists(location.root)) {
			this.state = { kind: "ready" };
			void this.refreshInactiveRoots();
			return true;
		}

		const candidates = await this.scan();
		if (!location.explicit) {
			// No record: the default is missing because this vault is new, or
			// because it predates movable roots and holds a legacy folder the
			// migration will read. Either way the default may be created —
			// unless our data already sits somewhere else, which is the
			// "folder synced before the setting did" case.
			let legacy = false;
			for (const name of LEGACY_PROJECT_ROOTS) {
				if (await this.fs.exists(name)) legacy = true;
			}
			if (legacy || candidates.length === 0) {
				this.state = { kind: "ready" };
				return true;
			}
		}
		this.enterMissing(candidates);
		return false;
	}

	// -------------------------------------------------------------------------
	// Vault events
	// -------------------------------------------------------------------------

	/**
	 * A rename, seen before the project-data event queue looks at it.
	 *
	 * Runs synchronously so that the root has already switched by the time
	 * the child events of the same drag arrive. Returns `true` when the event
	 * was about the root's location or shape and should go no further.
	 */
	onRename(file: TAbstractFile, oldPath: string): boolean {
		if (this.state.kind === "ready") {
			const root = projectPaths.root;
			const moved = relocatedPath(root, oldPath, file.path);
			if (moved !== null && file instanceof TFolder) {
				void this.follow(moved, { from: oldPath, to: file.path });
				return true;
			}
			if (this.isRelocationEcho(oldPath, file.path)) return true;
			if (isWithinRoot(oldPath, root) && oldPath !== root) {
				const name = oldPath.slice(root.length + 1);
				if ((PROJECT_STRUCTURE as readonly string[]).includes(name) && file.path !== oldPath) {
					// Only when the root is genuinely still where it was. Measured
					// on Obsidian 1.13.7: a folder move reports the folder first,
					// then each descendant — so by the time a child event arrives
					// the root has already switched and this branch is not taken.
					// The check stays for any build that orders them otherwise:
					// the folder object already carries its new path, so the old
					// one no longer resolves and nothing is put back.
					if (this.plugin.app.vault.getAbstractFileByPath(root) instanceof TFolder) {
						this.lastRevert = { from: oldPath, to: file.path, at: Date.now() };
						void this.revertStructureChange(file, oldPath, name);
						return true;
					}
				}
			}
			return false;
		}
		if (this.state.kind === "missing") {
			// A folder was renamed into the recorded location.
			const root = projectPaths.root;
			if (file instanceof TFolder && (file.path === root || root.startsWith(`${file.path}/`))) {
				this.scheduleMissingCheck();
				return true;
			}
		}
		return false;
	}

	/** A deletion; the root or its manifest may be gone. */
	onDelete(file: TAbstractFile): void {
		if (this.state.kind !== "ready") return;
		const root = projectPaths.root;
		if (file.path === root || root.startsWith(`${file.path}/`) || file.path === projectPaths.projectFile) {
			this.scheduleMissingCheck();
		}
	}

	/** A file appeared; it may be a manifest we were waiting for, or another root. */
	onCreate(file: TAbstractFile): void {
		const folder = rootOfProjectFile(file.path);
		if (folder === null) return;
		if (this.state.kind === "missing") {
			this.scheduleMissingCheck();
			return;
		}
		if (this.state.kind === "ready" && folder !== projectPaths.root) void this.refreshInactiveRoots();
	}

	/** Child renames of a move the controller itself adopted are not data events. */
	isRelocationEcho(oldPath: string, newPath: string): boolean {
		const now = Date.now();
		const move = this.lastMove;
		if (move && now - move.at <= RELOCATION_MEMORY_MS && relocatedPath(oldPath, move.from, move.to) === newPath) return true;
		const revert = this.lastRevert;
		if (revert && now - revert.at <= RELOCATION_MEMORY_MS) {
			if (relocatedPath(oldPath, revert.from, revert.to) === newPath) return true;
			if (relocatedPath(oldPath, revert.to, revert.from) === newPath) return true;
		}
		return false;
	}

	// -------------------------------------------------------------------------
	// Settings actions
	// -------------------------------------------------------------------------

	/** What `relocate` would say about a target, for the dialog to show as it is typed. */
	checkRelocation(input: string): RelocationCheck {
		const check = checkProjectRoot(input, { configDir: this.plugin.app.vault.configDir });
		if (!check.ok) return check;
		if (this.state.kind === "ready") {
			if (check.root === projectPaths.root) return { ok: false, problem: "same" };
			if (check.root.startsWith(`${projectPaths.root}/`)) return { ok: false, problem: "inside" };
		}
		const existing = this.plugin.app.vault.getAbstractFileByPath(check.root);
		if (existing instanceof TFolder) {
			// An empty folder is fine to move onto. While the root is missing, a
			// folder that already holds our manifest is fine too — that is the
			// writer pointing at data they found by hand.
			const empty = existing.children.length === 0;
			const holdsOurs = this.state.kind === "missing"
				&& this.plugin.app.vault.getAbstractFileByPath(projectFileIn(check.root)) !== null;
			if (!empty && !holdsOurs) return { ok: false, problem: "occupied" };
		} else if (existing) {
			return { ok: false, problem: "occupied" };
		}
		if (this.state.kind === "ready" && this.isBusy()) return { ok: false, problem: "busy" };
		return check;
	}

	/**
	 * Move the root to a new folder, or — when there is no root to move —
	 * point the plugin at the folder and let it create the layout there.
	 */
	async relocate(input: string): Promise<RelocationCheck> {
		const check = this.checkRelocation(input);
		if (!check.ok) return check;
		const target = check.root;
		if (this.state.kind === "missing") {
			await this.adopt(target);
			return check;
		}
		const from = projectPaths.root;
		const existing = this.plugin.app.vault.getAbstractFileByPath(target);
		if (existing instanceof TFolder) {
			// Empty by the check above. Obsidian will not rename onto it.
			await this.plugin.app.fileManager.trashFile(existing);
		}
		await this.ensureParentFolders(target);
		const folder = this.plugin.app.vault.getAbstractFileByPath(from);
		if (!(folder instanceof TFolder)) {
			// Vanished between the check and the move. Treat as missing.
			this.scheduleMissingCheck();
			return { ok: false, problem: "occupied" };
		}
		this.lastMove = { from, to: target, at: Date.now() };
		this.relocating = true;
		try {
			await this.plugin.app.fileManager.renameFile(folder, target);
			// The rename event has normally adopted the new root already; this
			// is for the case where it did not fire, and is a no-op otherwise.
			await this.follow(target, { from, to: target });
		} finally {
			this.relocating = false;
		}
		return check;
	}

	/** Switch to a folder the scan found. The previous one, if any, stays put. */
	async useCandidate(root: string): Promise<void> {
		await this.adopt(root);
	}

	/** The writer chose to start again at the recorded location. */
	async createHere(): Promise<void> {
		await this.adopt(projectPaths.root);
	}

	/** Look for our data anywhere in the vault. */
	async scan(): Promise<ProjectRootCandidate[]> {
		const roots = this.plugin.app.vault.getFiles()
			.filter((file) => file.name === PROJECT_FILE_NAME)
			.map((file) => rootOfProjectFile(file.path))
			.filter((root): root is string => root !== null);
		const candidates = await describeProjectRootCandidates(this.fs, roots, { configDir: this.plugin.app.vault.configDir });
		if (this.state.kind === "missing") this.state = { ...this.state, candidates };
		return candidates;
	}

	// -------------------------------------------------------------------------
	// Internals
	// -------------------------------------------------------------------------

	private isBusy(): boolean {
		return this.plugin.foregroundTurns.isActive || this.plugin.fullCorpusController.isRunning;
	}

	/** Adopt a root that moved under us. Idempotent. */
	private async follow(root: string, move: { from: string; to: string }): Promise<void> {
		if (projectPaths.root === root && this.state.kind === "ready") return;
		this.lastMove = { ...move, at: Date.now() };
		await this.adopt(root);
		if (!this.relocating) new Notice(t("main.rootFollowed", { root }), 8_000);
	}

	/** Point everything at `root`, record it, and reload what was read from the old one. */
	private async adopt(root: string): Promise<void> {
		this.missingNotice?.hide();
		this.missingNotice = null;
		setProjectRoot(root);
		this.explicit = true;
		this.state = { kind: "ready" };
		this.plugin.projectStore.rootChanged();
		await this.save(root);
		await this.plugin.reloadProjectData();
		void this.refreshInactiveRoots();
	}

	private async save(root: string): Promise<void> {
		await this.plugin.saveData(writeProjectLocation(await this.plugin.loadData(), root));
	}

	private enterMissing(candidates: ProjectRootCandidate[]): void {
		this.plugin.projectStore.markRootUnavailable();
		this.state = { kind: "missing", candidates, since: Date.now() };
		const root = projectPaths.root;
		const found = candidates[0];
		this.missingNotice?.hide();
		const notice = found
			? new Notice(t("main.rootFound", { root: found.root, count: found.conversations }), 0)
			: new Notice(t("main.rootMissing", { root }), 0);
		notice.messageEl.addClass("wb-notice-clickable");
		notice.messageEl.addEventListener("click", () => { notice.hide(); this.plugin.openSettings(); });
		this.missingNotice = notice;
		this.plugin.refreshViews();
	}

	/**
	 * Decide, a moment after the vault settled, whether the root is present.
	 *
	 * Sync and drags both arrive as bursts of events; one check after the
	 * burst is enough, and it is the only place the state flips either way.
	 */
	private scheduleMissingCheck(): void {
		if (this.missingCheck !== null) window.clearTimeout(this.missingCheck);
		this.missingCheck = window.setTimeout(() => {
			this.missingCheck = null;
			void this.checkPresence();
		}, 400);
	}

	private async checkPresence(): Promise<void> {
		// The recorded location may have changed under us: another device
		// moved the folder and sync delivered the new `data.json` too.
		const location = readProjectLocation(await this.plugin.loadData(), { configDir: this.plugin.app.vault.configDir });
		const recorded = location.explicit ? location.root : projectPaths.root;
		const present = await this.fs.exists(projectFileIn(recorded));
		if (this.state.kind === "ready") {
			if (present && recorded === projectPaths.root) return;
			if (present) {
				await this.follow(recorded, { from: projectPaths.root, to: recorded });
				return;
			}
			this.enterMissing(await this.scan());
			return;
		}
		if (this.state.kind === "missing") {
			if (!present) {
				this.state = { ...this.state, candidates: await this.scan() };
				this.plugin.refreshViews();
				return;
			}
			await this.adopt(recorded);
			new Notice(t("main.rootRecovered", { root: recorded }), 8_000);
		}
	}

	private async revertStructureChange(file: TAbstractFile, oldPath: string, name: string): Promise<void> {
		const root = projectPaths.root;
		try {
			await this.plugin.app.fileManager.renameFile(file, oldPath);
			new Notice(t("main.rootStructureReverted", { name, root }), 10_000);
		} catch {
			new Notice(t("main.rootStructureRevertFailed", { name, root }), 15_000);
		}
	}

	private async ensureParentFolders(path: string): Promise<void> {
		const parts = path.split("/").slice(0, -1);
		let current = "";
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			if (!this.plugin.app.vault.getAbstractFileByPath(current)) {
				await this.plugin.app.vault.createFolder(current);
			}
		}
	}

	private async refreshInactiveRoots(): Promise<void> {
		const candidates = await this.scan();
		this.inactiveRoots = candidates.filter((candidate) => candidate.root !== projectPaths.root);
		setInactiveProjectRoots(this.inactiveRoots.map((candidate) => candidate.root));
		this.plugin.refreshSettings();
	}
}
