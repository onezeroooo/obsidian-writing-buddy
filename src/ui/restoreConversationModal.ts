/**
 * Pick a previous local revision of the open conversation.
 *
 * The snapshots this lists are taken before every conversation overwrite and
 * kept outside the synced root, so they survive the one failure nothing else
 * covers: a sync replacing the file with content this device never read. See
 * `SessionHistoryStore`.
 *
 * Deliberately plain. Choosing a revision is rare, done under mild stress, and
 * every option is already safe — restoring snapshots the current content first
 * — so the dialog states what it will do and gets out of the way.
 */

import { App, Modal, Setting } from "obsidian";
import { t } from "../i18n";

export interface RestorableRevision {
	path: string;
	/** `20260906-014233-102`, as written by the history store. */
	stamp: string;
	/** Message count, when the revision parsed. Absent means unreadable. */
	messageCount?: number;
}

export class RestoreConversationModal extends Modal {
	private resolve: ((chosen: RestorableRevision | null) => void) | null = null;
	private resolved = false;

	constructor(
		app: App,
		private readonly revisions: readonly RestorableRevision[],
	) {
		super(app);
	}

	openAndPick(): Promise<RestorableRevision | null> {
		return new Promise((resolve) => {
			this.resolve = resolve;
			this.open();
		});
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("wb-modal");
		contentEl.createEl("h3", { text: t("main.restorePickTitle") });
		contentEl.createEl("p", { cls: "wb-modal-hint", text: t("main.restorePickDesc") });

		for (const revision of this.revisions) {
			new Setting(contentEl)
				.setName(t("main.restoreEntryLabel", {
					stamp: readableStamp(revision.stamp),
					count: revision.messageCount ?? 0,
				}))
				.addButton((button) => button
					.setButtonText(t("common.restore"))
					.onClick(() => this.finish(revision)));
		}

		new Setting(contentEl).addButton((button) => button
			.setButtonText(t("common.cancel"))
			.onClick(() => this.finish(null)));
	}

	onClose(): void {
		this.contentEl.empty();
		this.finish(null);
	}

	private finish(chosen: RestorableRevision | null): void {
		if (this.resolved) return;
		this.resolved = true;
		this.resolve?.(chosen);
		this.resolve = null;
		this.close();
	}
}

/** `20260906-014233-102` reads as `2026-09-06 01:42:33`. */
export function readableStamp(stamp: string): string {
	const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-\d{3})?$/u.exec(stamp);
	if (!match) return stamp;
	const [, year, month, day, hour, minute, second] = match;
	return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}
