/**
 * Choose where the project data folder goes.
 *
 * The same gesture as Obsidian's own "Move folder to…": a fuzzy list of the
 * folders the data folder can be placed *in*; pick one and the folder moves
 * there under its current name. Renaming stays a file-tree action, and so
 * does dragging — this exists for the cases a drag cannot reach: a phone, a
 * destination that does not exist yet, or a root that is currently missing.
 *
 * Two modes. `move` (the ordinary case) lists destinations for the existing
 * folder. `pick` (while the root is missing) lists folders that could *be*
 * the data folder — one that already holds a manifest, or an empty one.
 */

import { App, Notice, SuggestModal, prepareFuzzySearch } from "obsidian";
import type WritingBuddyPlugin from "../main";
import { t } from "../i18n";
import { DEFAULT_PROJECT_ROOT, checkProjectRoot, isWithinRoot, normalizeProjectRootInput } from "../storage/paths";
import { projectFileIn } from "../storage/projectLocation";
import { iconSpan } from "./icons";

type Destination =
	| { kind: "default" }
	| { kind: "vault-root" }
	| { kind: "folder"; path: string }
	| { kind: "new"; path: string };

export class ProjectLocationModal extends SuggestModal<Destination> {
	private readonly mode: "move" | "pick";
	/** The folder's own name, carried along in `move` mode. */
	private readonly name: string;
	private readonly folders: string[];

	constructor(
		app: App,
		private readonly plugin: WritingBuddyPlugin,
		private readonly onDone: () => void = () => undefined,
	) {
		super(app);
		const controller = plugin.projectRoot;
		this.mode = controller.state.kind === "missing" ? "pick" : "move";
		this.name = controller.root.split("/").pop() || DEFAULT_PROJECT_ROOT;
		this.folders = this.eligibleFolders();
		this.setPlaceholder(this.mode === "move" ? t("locModal.placeholderMove", { name: this.name }) : t("locModal.placeholderPick"));
		this.setInstructions([
			{ command: "↑↓", purpose: t("locModal.navigate") },
			{ command: "↵", purpose: this.mode === "move" ? t("locModal.move") : t("locModal.use") },
			{ command: "esc", purpose: t("common.cancel") },
		]);
		this.emptyStateText = t("locModal.noMatch");
		this.modalEl.addClass("wb-location-modal");
	}

	getSuggestions(query: string): Destination[] {
		const controller = this.plugin.projectRoot;
		const trimmed = normalizeProjectRootInput(query);
		const items: Destination[] = [];
		if (trimmed.length === 0) {
			if (this.mode === "move" && !controller.isDefault) items.push({ kind: "default" });
			if (this.mode === "pick" && controller.root !== DEFAULT_PROJECT_ROOT) items.push({ kind: "default" });
			if (this.mode === "move" && controller.root.includes("/")) items.push({ kind: "vault-root" });
		}
		const search = prepareFuzzySearch(query);
		const matched = this.folders
			.map((path) => ({ path, match: search(path) }))
			.filter((entry) => entry.match !== null)
			.sort((left, right) => (right.match?.score ?? 0) - (left.match?.score ?? 0) || left.path.localeCompare(right.path))
			.slice(0, 50)
			.map((entry): Destination => ({ kind: "folder", path: entry.path }));
		items.push(...matched);
		// A path that is not a folder yet: offer to create it. Its validity is
		// judged on the full target, so a hidden or reserved name is not offered.
		if (trimmed.length > 0 && !this.folders.includes(trimmed) && !this.app.vault.getAbstractFileByPath(trimmed)) {
			if (controller.checkRelocation(this.targetFor({ kind: "new", path: trimmed })).ok) items.push({ kind: "new", path: trimmed });
		}
		return items;
	}

	renderSuggestion(item: Destination, el: HTMLElement): void {
		el.addClass("wb-location-suggestion");
		const target = this.targetFor(item);
		const check = this.plugin.projectRoot.checkRelocation(target);
		if (!check.ok) el.addClass("is-refused");
		const line = el.createDiv({ cls: "wb-location-suggestion-line" });
		iconSpan(line, item.kind === "new" ? "folder-plus" : item.kind === "default" ? "rotate-ccw" : "folder", "wb-location-suggestion-icon");
		switch (item.kind) {
			case "default":
				line.createSpan({ text: t("locModal.restoreDefault") });
				break;
			case "vault-root":
				line.createSpan({ text: t("locModal.vaultRoot") });
				break;
			case "folder":
				line.createSpan({ text: item.path });
				break;
			case "new":
				line.createSpan({ text: t("locModal.createFolder", { path: item.path }) });
				break;
		}
		const detail = el.createDiv({ cls: "wb-location-suggestion-detail" });
		detail.setText(check.ok
			? (this.mode === "move" ? t("locModal.willMoveTo", { target }) : t("locModal.willUse", { target }))
			: t(`locModal.problem.${check.problem}`));
	}

	onChooseSuggestion(item: Destination): void {
		void this.choose(item);
	}

	private async choose(item: Destination): Promise<void> {
		const target = this.targetFor(item);
		const check = this.plugin.projectRoot.checkRelocation(target);
		if (!check.ok) {
			new Notice(t(`locModal.problem.${check.problem}`), 6_000);
			return;
		}
		try {
			const result = await this.plugin.projectRoot.relocate(target);
			if (!result.ok) {
				new Notice(t(`locModal.problem.${result.problem}`), 6_000);
				return;
			}
			new Notice(this.mode === "move" ? t("locModal.moved", { root: result.root }) : t("settings.location.switched", { root: result.root }), 8_000);
			this.onDone();
		} catch (error) {
			new Notice(t("locModal.failed", { reason: error instanceof Error ? error.message : String(error) }), 10_000);
		}
	}

	/** The full root path a choice stands for. */
	private targetFor(item: Destination): string {
		switch (item.kind) {
			case "default":
				return DEFAULT_PROJECT_ROOT;
			case "vault-root":
				return this.name;
			case "folder":
			case "new":
				return this.mode === "move" ? `${item.path}/${this.name}` : item.path;
		}
	}

	/**
	 * Folders worth listing. In `move` mode: anywhere the data folder may be
	 * placed, so never itself, nothing beneath it, nothing hidden or reserved.
	 * In `pick` mode: folders that hold a manifest of ours, or are empty.
	 */
	private eligibleFolders(): string[] {
		const controller = this.plugin.projectRoot;
		const configDir = this.app.vault.configDir;
		const out: string[] = [];
		for (const folder of this.app.vault.getAllFolders(false)) {
			const path = folder.path;
			if (!checkProjectRoot(path, { configDir }).ok) continue;
			if (this.mode === "move") {
				if (isWithinRoot(path, controller.root)) continue;
				out.push(path);
			} else {
				const holdsOurs = this.app.vault.getAbstractFileByPath(projectFileIn(path)) !== null;
				if (holdsOurs || folder.children.length === 0) out.push(path);
			}
		}
		return out.sort((left, right) => left.localeCompare(right));
	}
}
