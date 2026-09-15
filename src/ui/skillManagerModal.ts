/** Focused, writer-facing views for packaged and user-owned Skills. */
import { App, Modal, Setting } from "obsidian";
import { t } from "../i18n";
import type { Skill, SkillAction, SkillScope } from "../types";
import { serializeSkill } from "../skills/skillParser";
import type { SkillRouteResult } from "../session/skillRouting";

export interface BuiltinSkillModalOptions {
	mode: "view" | "customize";
	skill: Skill;
	initialCustomization?: string;
	/** Legacy full replacements remain replacements until explicitly reset. */
	customizationMode?: "extend" | "replace";
	onSave?: (extension: string) => Promise<void>;
	/**
	 * Route one sentence against the live registry. Supplied by the caller so
	 * this surface stays free of registry and session state.
	 */
	routingProbe?: (message: string) => SkillRouteResult;
}

/**
 * Explain one routing outcome for the Skill being viewed.
 *
 * Routing is a deterministic phrase match with three veto rules, and none of it
 * was visible: a Skill either fired or silently did not, and the author had no
 * way to find out which rule decided that. `routeSkill` already returns every
 * candidate with the status it was given — this reads that answer back out
 * instead of asking the author to reverse-engineer it from behaviour.
 */
export function describeRouteOutcome(result: SkillRouteResult, skill: Skill): string {
	const mine = result.candidates.find((candidate) => candidate.skill.id === skill.id);
	if (result.skill?.id === skill.id) {
		return result.matchedPhrase
			? t("skillModal.routeHit", { phrase: result.matchedPhrase })
			: t("skillModal.routeHitNoPhrase");
	}
	if (!mine) {
		return result.skill
			? t("skillModal.routeMissOther", { name: result.skill.name })
			: t("skillModal.routeMissChat");
	}
	switch (mine.status) {
		case "rejected-no-selection":
			return t("skillModal.routeNeedsSelection", { phrase: mine.phrase });
		case "rejected-negated":
			return t("skillModal.routeNegated", { phrase: mine.phrase });
		case "rejected-question":
			return t("skillModal.routeQuestion", { phrase: mine.phrase });
		case "eligible":
			return result.skill
				? t("skillModal.routeOutranked", { phrase: mine.phrase, name: result.skill.name })
				: t("skillModal.routeNotChosen", { phrase: mine.phrase });
	}
}

/**
 * Shows release-owned task semantics, or edits only the writer-owned extension.
 * Product policy and the combined effective instruction are intentionally not
 * part of this surface.
 */
export class BuiltinSkillModal extends Modal {
	private customization: string;
	private saving = false;
	private status = "";

	constructor(app: App, private readonly options: BuiltinSkillModalOptions) {
		super(app);
		this.customization = options.initialCustomization ?? "";
	}

	onOpen(): void {
		this.modalEl.addClass("wb-skill-modal-shell");
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("wb-skill-modal");
		const viewing = this.options.mode === "view";
		contentEl.createEl("h2", {
			text: viewing
				? t("skillModal.viewTitle", { name: this.options.skill.name })
				: t("skillModal.customizeTitle", { name: this.options.skill.name }),
		});

		if (viewing) this.renderBuiltin(contentEl);
		else this.renderCustomization(contentEl);
	}

	private renderBuiltin(contentEl: HTMLElement): void {
		new Setting(contentEl).setName(t("skillModal.fieldVersion")).setDesc(`v${this.options.skill.version}`);
		new Setting(contentEl).setName(t("skillModal.fieldAction")).setDesc(actionLabel(this.options.skill.action));
		new Setting(contentEl).setName(t("skillModal.fieldScope")).setDesc(scopeLabel(this.options.skill.scope));
		if (this.options.skill.description) {
			new Setting(contentEl).setName(t("skillModal.fieldDescription")).setDesc(this.options.skill.description);
		}

		new Setting(contentEl)
			.setName(t("skillModal.builtinInstruction"))
			.setDesc(t("skillModal.builtinInstructionDesc"));
		contentEl.createDiv({
			cls: "wb-skill-instruction-preview",
			text: this.options.skill.instruction,
			attr: { role: "note" },
		});

		this.renderRoutingProbe(contentEl);

		new Setting(contentEl)
			.setClass("wb-skill-modal-actions")
			.addButton((button) => button.setButtonText(t("common.close")).setCta().onClick(() => this.close()));
	}

	/** Answer "would this sentence reach this Skill?" without having to send it. */
	private renderRoutingProbe(contentEl: HTMLElement): void {
		const probe = this.options.routingProbe;
		if (!probe) return;

		new Setting(contentEl)
			.setName(t("skillModal.probeName"))
			.setDesc(t("skillModal.probeDesc"));

		const verdict = contentEl.createDiv({
			cls: "wb-skill-routing-verdict",
			text: t("skillModal.probeIdle"),
			attr: { role: "status", "aria-live": "polite" },
		});

		new Setting(contentEl)
			.setClass("wb-skill-routing-field")
			.addText((text) => text
				.setPlaceholder(t("skillModal.probePlaceholder"))
				.onChange((value) => {
					const message = value.trim();
					verdict.setText(message
						? describeRouteOutcome(probe(message), this.options.skill)
						: t("skillModal.probeIdle"));
				}));
	}

	private renderCustomization(contentEl: HTMLElement): void {
		const replacement = this.options.customizationMode === "replace";
		contentEl.createEl("p", {
			cls: "wb-skill-modal-intro",
			text: replacement ? t("skillModal.replaceIntro") : t("skillModal.extendIntro"),
		});

		new Setting(contentEl)
			.setClass("wb-skill-instruction-field")
			.setName(replacement ? t("skillModal.legacyReplacement") : t("skillModal.myCustomization"))
			.setDesc(replacement ? t("skillModal.replaceFieldDesc") : t("skillModal.extendFieldDesc"))
			.addTextArea((text) => {
				text.inputEl.rows = 10;
				return text
					.setPlaceholder(t("skillModal.customizePlaceholder"))
					.setValue(this.customization)
					.onChange((value) => { this.customization = value; });
			});

		contentEl.createDiv({
			cls: "wb-settings-status wb-skill-modal-status",
			text: this.status,
			attr: { role: "status", "aria-live": "polite" },
		});

		new Setting(contentEl)
			.setClass("wb-skill-modal-actions")
			.addButton((button) => button.setButtonText(t("common.cancel")).setDisabled(this.saving).onClick(() => this.close()))
			.addButton((button) => button
				.setButtonText(this.saving ? t("common.saving") : t("skillModal.saveCustomization"))
				.setCta()
				.setDisabled(this.saving)
				.onClick(() => void this.saveCustomization()));
	}

	private async saveCustomization(): Promise<void> {
		if (this.saving) return;
		const extension = this.customization.trim();
		if (!extension) {
			this.status = t("skillModal.emptyCustomization");
			this.render();
			return;
		}
		if (!this.options.onSave) return;
		this.saving = true;
		this.status = t("common.saving");
		this.render();
		try {
			await this.options.onSave(extension);
			this.close();
		} catch (error) {
			this.saving = false;
			this.status = skillSaveError(error);
			this.render();
		}
	}
}

export interface SkillDraft {
	id: string;
	name: string;
	description: string;
	action: SkillAction;
	scope: SkillScope;
	triggers: string;
	instruction: string;
	version: number;
	/** Existing advanced metadata is preserved even though this focused form does not expose it. */
	composerPrompt?: string;
	instructionProfile?: Skill["instructionProfile"];
	allowQuestions?: boolean;
}

export interface CustomSkillModalOptions {
	skill?: Skill;
	existingPath?: string;
	reservedIds?: Iterable<string>;
	onSave: (source: string, existingPath?: string) => Promise<void>;
}

/** A structured editor for writer-owned Skills; Markdown remains an implementation detail. */
export class CustomSkillModal extends Modal {
	private readonly editing: boolean;
	private readonly reservedIds: Set<string>;
	private draft: SkillDraft;
	private saving = false;
	private status = "";

	constructor(app: App, private readonly options: CustomSkillModalOptions) {
		super(app);
		this.editing = options.skill !== undefined;
		this.reservedIds = new Set(options.reservedIds ?? []);
		this.draft = skillDraftFrom(options.skill);
	}

	onOpen(): void {
		this.modalEl.addClass("wb-skill-modal-shell");
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("wb-skill-modal");
		contentEl.createEl("h2", { text: this.editing ? t("skillModal.editTitle", { name: this.draft.name }) : t("skillModal.newTitle") });
		contentEl.createEl("p", {
			cls: "wb-skill-modal-intro",
			text: t("skillModal.customIntro"),
		});

		new Setting(contentEl).setName(t("skillModal.fieldId")).setDesc(this.editing ? t("skillModal.idKeep") : t("skillModal.idFormat")).addText((text) =>
			text.setPlaceholder(t("skillModal.idPlaceholder")).setValue(this.draft.id).setDisabled(this.editing).onChange((value) => { this.draft.id = value.trim(); }),
		);
		new Setting(contentEl).setName(t("skillModal.fieldName")).addText((text) =>
			text.setPlaceholder(t("skillModal.namePlaceholder")).setValue(this.draft.name).onChange((value) => { this.draft.name = value; }),
		);
		new Setting(contentEl).setName(t("skillModal.fieldDescription")).setDesc(t("skillModal.descriptionDesc")).addText((text) =>
			text.setValue(this.draft.description).onChange((value) => { this.draft.description = value; }),
		);
		new Setting(contentEl).setName(t("skillModal.fieldAction")).addDropdown((dropdown) => dropdown
			.addOptions({ chat: t("skill.action.chat"), rewrite: t("skill.action.rewrite"), continue: t("skill.action.continue") })
			.setValue(this.draft.action)
			.onChange((value) => { this.draft.action = value as SkillAction; }));
		new Setting(contentEl).setName(t("skillModal.fieldScope")).addDropdown((dropdown) => dropdown
			.addOptions({ selection: t("skill.scope.selection"), "current-document": t("skill.scope.currentDocument"), project: t("skill.scope.project") })
			.setValue(this.draft.scope)
			.onChange((value) => { this.draft.scope = value as SkillScope; }));
		new Setting(contentEl).setName(t("skillModal.fieldTriggers")).setDesc(t("skillModal.triggersDesc")).addText((text) =>
			text.setPlaceholder(t("skillModal.triggersPlaceholder")).setValue(this.draft.triggers).onChange((value) => { this.draft.triggers = value; }),
		);
		new Setting(contentEl)
			.setClass("wb-skill-instruction-field")
			.setName(t("skillModal.fieldInstruction"))
			.setDesc(t("skillModal.instructionDesc"))
			.addTextArea((text) => {
				text.inputEl.rows = 10;
				return text.setValue(this.draft.instruction).onChange((value) => { this.draft.instruction = value; });
			});

		contentEl.createDiv({
			cls: "wb-settings-status wb-skill-modal-status",
			text: this.status,
			attr: { role: "status", "aria-live": "polite" },
		});
		new Setting(contentEl)
			.setClass("wb-skill-modal-actions")
			.addButton((button) => button.setButtonText(t("common.cancel")).setDisabled(this.saving).onClick(() => this.close()))
			.addButton((button) => button
				.setButtonText(this.saving ? t("common.saving") : t("skillModal.saveSkill"))
				.setCta()
				.setDisabled(this.saving)
				.onClick(() => void this.save()));
	}

	private async save(): Promise<void> {
		if (this.saving) return;
		const problem = validateSkillDraft(this.draft, this.editing ? undefined : this.reservedIds);
		if (problem) {
			this.status = problem;
			this.render();
			return;
		}

		this.saving = true;
		this.status = t("common.saving");
		this.render();
		try {
			await this.options.onSave(serializeSkillDraft(this.draft), this.options.existingPath);
			this.close();
		} catch (error) {
			this.saving = false;
			this.status = skillSaveError(error);
			this.render();
		}
	}
}

export function skillDraftFrom(skill?: Skill): SkillDraft {
	return {
		id: skill?.id ?? "",
		name: skill?.name ?? "",
		description: skill?.description ?? "",
		action: skill?.action ?? "chat",
		scope: skill?.scope ?? "selection",
		triggers: (skill?.routing?.phrases ?? skill?.triggers ?? []).join(", "),
		instruction: skill?.instruction ?? "",
		version: skill?.version ?? 1,
		...(skill?.composerPrompt ? { composerPrompt: skill.composerPrompt } : {}),
		...(skill?.instructionProfile ? { instructionProfile: skill.instructionProfile } : {}),
		...(skill?.routing?.allowQuestions !== undefined ? { allowQuestions: skill.routing.allowQuestions } : {}),
	};
}

export function validateSkillDraft(draft: SkillDraft, reservedIds?: ReadonlySet<string>): string | null {
	if (!draft.id.trim()) return t("skillModal.idRequired");
	if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(draft.id.trim())) return t("skillModal.idInvalid");
	if (reservedIds?.has(draft.id.trim())) return t("skillModal.idTaken");
	if (!draft.name.trim()) return t("skillModal.nameRequired");
	if (!draft.instruction.trim()) return t("skillModal.instructionRequired");
	return null;
}

export function serializeSkillDraft(draft: SkillDraft): string {
	const phrases = draft.triggers
		.split(/[、,，;；|]/)
		.map((value) => value.trim())
		.filter(Boolean);
	const skill: Skill = {
		id: draft.id.trim(),
		name: draft.name.trim(),
		action: draft.action,
		scope: draft.scope,
		version: draft.version,
		instruction: draft.instruction.trim(),
		builtin: false,
	};
	if (draft.description.trim()) skill.description = draft.description.trim();
	if (draft.composerPrompt) skill.composerPrompt = draft.composerPrompt;
	if (draft.instructionProfile) skill.instructionProfile = draft.instructionProfile;
	if (phrases.length > 0) {
		skill.triggers = phrases;
		skill.routing = {
			phrases,
			...(draft.allowQuestions !== undefined ? { allowQuestions: draft.allowQuestions } : {}),
		};
	}
	return serializeSkill(skill);
}

export function actionLabel(action: SkillAction): string {
	if (action === "rewrite") return t("skill.action.rewrite");
	if (action === "continue") return t("skill.action.continue");
	return t("skill.action.chat");
}

export function scopeLabel(scope: SkillScope): string {
	if (scope === "current-document") return t("skill.scope.currentDocument");
	if (scope === "project") return t("skill.scope.project");
	return t("skill.scope.selection");
}

function skillSaveError(error: unknown): string {
	const detail = error instanceof Error ? error.message : String(error);
	if (/already exists|conflicts with built-in/iu.test(detail)) return t("skillModal.saveIdTaken");
	if (/conflicted customization|multiple|duplicate/iu.test(detail)) return t("skillModal.saveConflict");
	if (/empty/iu.test(detail)) return t("skillModal.saveEmpty");
	return t("skillModal.saveGeneric");
}
