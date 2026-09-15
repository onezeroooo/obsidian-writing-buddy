/**
 * Shared confirmation modal for decisions that genuinely need confirmation.
 *
 * The rewrite instruction dialog used to live here. It is gone: a writing action
 * now fills the composer, where the writer can see and edit the ask in the same
 * place they type everything else, instead of answering a dialog that then runs
 * something invisible. Confirmation is reserved for irreversible or unverified
 * writes; replacing a context attachment and reversible archiving do not ask twice.
 *
 * It is promise-based and restores focus on every close path, including
 * dismissal. A modal that resolves through a callback chain tends to leave the
 * composer without keyboard focus afterwards, and the writer has to click back
 * into it before they can type again.
 */

import { App, Modal, Setting } from "obsidian";
import { t } from "../i18n";

export interface ConfirmOptions {
	title: string;
	body: string;
	/** Label of the affirmative button. Says what will happen, not "OK". */
	confirmText: string;
	cancelText?: string;
	/** Use Obsidian's red destructive treatment for irreversible actions. */
	destructive?: boolean;
}

export class ConfirmModal extends Modal {
	private resolved = false;
	private resolve: ((confirmed: boolean) => void) | null = null;

	constructor(
		app: App,
		private readonly options: ConfirmOptions,
	) {
		super(app);
	}

	openAndConfirm(): Promise<boolean> {
		return new Promise((resolve) => {
			this.resolve = resolve;
			this.open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("wb-modal");
		contentEl.createEl("h3", { text: this.options.title });
		contentEl.createEl("p", { cls: "wb-modal-hint", text: this.options.body });

		const controls = new Setting(contentEl)
			.addButton((button) =>
				button.setButtonText(this.options.cancelText ?? t("common.cancel")).onClick(() => this.finish(false)),
			);
		controls.addButton((button) => {
			button.setButtonText(this.options.confirmText);
			if (this.options.destructive) button.setWarning();
			else button.setCta();
			button.onClick(() => this.finish(true));
		});
	}

	onClose(): void {
		this.contentEl.empty();
		// A dismissed modal is a cancel, not a hang.
		this.finish(false);
	}

	private finish(confirmed: boolean): void {
		if (this.resolved) return;
		this.resolved = true;
		this.resolve?.(confirmed);
		this.close();
	}
}

/**
 * Ask before deleting, and mean it.
 *
 * This one is not reversible and there is no undo behind it, so the question
 * names the conversation, says how much is in it, and says plainly that the file
 * goes.
 */
export function confirmDelete(app: App, title: string, messageCount: number): Promise<boolean> {
	return new ConfirmModal(app, {
		title: t("modals.deleteSessionTitle"),
		body: t("modals.deleteSessionBody", { title, count: messageCount }),
		confirmText: t("modals.deletePermanently"),
		destructive: true,
	}).openAndConfirm();
}
