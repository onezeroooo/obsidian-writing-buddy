/** Focused views for the optional, writer-owned project instructions file. */
import { App, Modal, Setting } from "obsidian";
import { t } from "../i18n";
import type { ProjectInstructionsState } from "../instructions";

export type ProjectInstructionsModalMode = "view" | "create" | "edit";

export interface ProjectInstructionsPresentation {
	statusLabel: string;
	statusClass: "is-absent" | "is-active" | "is-invalid";
	safeBody: string;
	canView: boolean;
	canClear: boolean;
	editLabel: string;
}

export type ProjectInstructionsSaveResult =
	| { ok: true; state: ProjectInstructionsState }
	| { ok: false; message: string; state?: ProjectInstructionsState };

interface ProjectInstructionsModalOptions {
	mode: ProjectInstructionsModalMode;
	state: ProjectInstructionsState;
	onSave?: (source: string) => Promise<ProjectInstructionsState>;
	onSaved?: (state: ProjectInstructionsState) => void | Promise<void>;
}

/**
 * Reduce a storage state to what Settings may safely expose. In particular, an
 * invalid state never contributes preview or editor text even if a faulty
 * implementation accidentally attaches the rejected source to `text`.
 */
export function projectInstructionsPresentation(
	state: ProjectInstructionsState,
): ProjectInstructionsPresentation {
	if (state.status === "active") {
		return {
			statusLabel: t("projInstr.statusActive"),
			statusClass: "is-active",
			safeBody: state.text,
			canView: true,
			canClear: true,
			editLabel: t("common.edit"),
		};
	}
	if (state.status === "invalid") {
		return {
			statusLabel: t("projInstr.statusInvalid"),
			statusClass: "is-invalid",
			safeBody: "",
			canView: true,
			canClear: true,
			editLabel: t("common.edit"),
		};
	}
	return {
		statusLabel: t("projInstr.statusAbsent"),
		statusClass: "is-absent",
		safeBody: "",
		canView: false,
		canClear: false,
		editLabel: t("projInstr.create"),
	};
}

/** Validate an explicit edit and keep rejected content in the editor. */
export async function submitProjectInstructionsDraft(
	source: string,
	save: (source: string) => Promise<ProjectInstructionsState>,
): Promise<ProjectInstructionsSaveResult> {
	if (!source.trim()) {
		return { ok: false, message: t("projInstr.emptyDraft") };
	}

	let state: ProjectInstructionsState;
	try {
		state = await save(source);
	} catch {
		return { ok: false, message: t("projInstr.saveFailed") };
	}
	if (state.status === "active") return { ok: true, state };
	if (state.status === "invalid") {
		return {
			ok: false,
			message: projectInstructionsInvalidMessage(state),
			state,
		};
	}
	return { ok: false, message: t("projInstr.emptyBody"), state };
}

/** Confirmation is a hard gate: cancellation cannot reach the storage clear. */
export async function clearProjectInstructionsAfterConfirmation(
	confirm: () => Promise<boolean>,
	clear: () => Promise<ProjectInstructionsState>,
): Promise<ProjectInstructionsState | null> {
	if (!(await confirm())) return null;
	return clear();
}

/** Shows only this customization file, never product-owned instruction layers. */
export class ProjectInstructionsModal extends Modal {
	private draft: string;
	private saving = false;
	private status = "";

	constructor(app: App, private readonly options: ProjectInstructionsModalOptions) {
		super(app);
		this.draft = projectInstructionsPresentation(options.state).safeBody;
	}

	onOpen(): void {
		this.modalEl.addClass("wb-project-instructions-modal-shell");
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("wb-project-instructions-modal");
		if (this.options.mode === "view") this.renderView(contentEl);
		else this.renderEditor(contentEl);
	}

	private renderView(contentEl: HTMLElement): void {
		const presentation = projectInstructionsPresentation(this.options.state);
		contentEl.createEl("h2", { text: t("projInstr.viewTitle") });
		contentEl.createEl("p", {
			cls: "wb-project-instructions-intro",
			text: t("projInstr.viewIntro"),
		});
		this.renderFileMetadata(contentEl, presentation);

		if (this.options.state.status === "active") {
			new Setting(contentEl)
				.setName(t("projInstr.currentBodyName"))
				.setDesc(t("projInstr.currentBodyDesc"));
			contentEl.createEl("pre", {
				cls: "wb-project-instructions-preview",
				text: presentation.safeBody,
				attr: { role: "note" },
			});
		} else {
			contentEl.createDiv({
				cls: "wb-project-instructions-warning",
				text: t("projInstr.invalidHidden"),
				attr: { role: "status" },
			});
		}

		new Setting(contentEl)
			.setClass("wb-project-instructions-modal-actions")
			.addButton((button) => button.setButtonText(t("common.close")).setCta().onClick(() => this.close()));
	}

	private renderEditor(contentEl: HTMLElement): void {
		const presentation = projectInstructionsPresentation(this.options.state);
		contentEl.createEl("h2", { text: this.options.mode === "create" ? t("projInstr.createTitle") : t("projInstr.editTitle") });
		contentEl.createEl("p", {
			cls: "wb-project-instructions-intro",
			text: t("projInstr.editorIntro"),
		});
		this.renderFileMetadata(contentEl, presentation);

		if (this.options.state.status === "invalid") {
			contentEl.createDiv({
				cls: "wb-project-instructions-warning",
				text: t("projInstr.invalidReplace"),
				attr: { role: "status" },
			});
		}

		new Setting(contentEl)
			.setClass("wb-project-instructions-field")
			.setName(t("projInstr.fieldBody"))
			.setDesc(t("projInstr.fieldBodyDesc"))
			.addTextArea((text) => {
				text.inputEl.rows = 12;
				return text
					.setPlaceholder(t("projInstr.bodyPlaceholder"))
					.setValue(this.draft)
					.onChange((value) => { this.draft = value; });
			});

		contentEl.createDiv({
			cls: "wb-settings-status wb-project-instructions-modal-status",
			text: this.status,
			attr: { role: "status", "aria-live": "polite" },
		});

		new Setting(contentEl)
			.setClass("wb-project-instructions-modal-actions")
			.addButton((button) => button.setButtonText(t("common.cancel")).setDisabled(this.saving).onClick(() => this.close()))
			.addButton((button) => button
				.setButtonText(this.saving ? t("common.saving") : t("projInstr.saveButton"))
				.setCta()
				.setDisabled(this.saving)
				.onClick(() => void this.save()));
	}

	private renderFileMetadata(
		contentEl: HTMLElement,
		presentation: ProjectInstructionsPresentation,
	): void {
		new Setting(contentEl).setName(t("connModal.fieldStatus")).setDesc(presentation.statusLabel);
		new Setting(contentEl).setName(t("projInstr.vaultPath")).setDesc(this.options.state.path);
	}

	private async save(): Promise<void> {
		if (this.saving || !this.options.onSave) return;
		this.saving = true;
		this.status = t("common.saving");
		this.render();
		const result = await submitProjectInstructionsDraft(this.draft, this.options.onSave);
		if (!result.ok) {
			this.saving = false;
			this.status = result.message;
			this.render();
			return;
		}
		try {
			await this.options.onSaved?.(result.state);
		} finally {
			this.close();
		}
	}
}

function projectInstructionsInvalidMessage(state: ProjectInstructionsState): string {
	const detail = state.error ?? t("projInstr.invalidDefault");
	if (/credential-looking|forbidden/iu.test(detail)) {
		return t("projInstr.credentialField");
	}
	if (/unterminated/iu.test(detail)) {
		return t("projInstr.unterminated");
	}
	return t("projInstr.saveGenericFail");
}
