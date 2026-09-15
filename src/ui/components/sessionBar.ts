/**
 * The title row: which conversation you are in, and the controls for moving
 * between conversations.
 *
 * The title is text, not a control. It was previously a button that opened the
 * session list, which conflated "what am I in" with "where else could I go" —
 * so history has exactly one obvious entry, the history icon, and the title only
 * ever names the current conversation.
 *
 * It reads as a *name*, not as a page heading: normal weight, muted, preceded by
 * a small conversation glyph, and set well below the product header. Rename is
 * inline and appears on hover or focus, so the title stays quiet while still
 * being editable without hunting through a menu.
 *
 * The three-dot control opens Settings directly. It used to open a menu whose
 * only item was Settings, which is a click spent on nothing.
 */

import { t } from "../../i18n";
import { ICONS, iconButton, iconSpan } from "../icons";

export interface SessionBarOptions {
	title: string | null;
	/** Total conversations, used only as a hint in the history tooltip. */
	conversationCount: number;
	/** True when there is a conversation with content worth summarising. */
	canRegenerate: boolean;
	onRename: (next: string) => void;
	/** Rename from what the conversation has actually become. */
	onRegenerateTitle: () => void;
	onNewConversation: () => void;
	onOpenHistory: () => void;
	onOpenSettings: () => void;
}

export function renderSessionBar(parent: HTMLElement, options: SessionBarOptions): void {
	const bar = parent.createDiv({ cls: "wb-session-bar" });
	const titleWrap = bar.createDiv({ cls: "wb-title-wrap" });
	iconSpan(titleWrap, ICONS.conversation, "wb-title-icon");

	if (options.title === null) {
		titleWrap.createDiv({ cls: "wb-title wb-title-empty", text: t("sessionBar.newConversation") });
	} else {
		renderEditableTitle(titleWrap, options.title, options);
	}

	const actions = bar.createDiv({ cls: "wb-session-actions" });

	iconButton(actions, {
		icon: ICONS.newConversation,
		label: t("sessionBar.newSession"),
		cls: "wb-session-action wb-session-action-new",
		onClick: () => options.onNewConversation(),
	});

	iconButton(actions, {
		icon: ICONS.history,
		label: options.conversationCount > 0 ? t("sessionBar.historyWithCount", { count: options.conversationCount }) : t("sessionBar.history"),
		cls: "wb-session-action",
		onClick: () => options.onOpenHistory(),
	});

	iconButton(actions, {
		icon: ICONS.more,
		label: t("sessionBar.settings"),
		cls: "wb-session-action",
		onClick: () => options.onOpenSettings(),
	});
}

/**
 * A title that becomes an input when you ask it to.
 *
 * The pencil is a real focusable button rather than a hover-only affordance, so
 * renaming is reachable by keyboard. Double-clicking the title does the same
 * thing for anyone who expects that.
 */
function renderEditableTitle(parent: HTMLElement, title: string, options: SessionBarOptions): void {
	const onRename = options.onRename;
	const heading = parent.createDiv({ cls: "wb-title", text: title, attr: { title } });

	const beginEdit = (): void => {
		const input = parent.createEl("input", {
			cls: "wb-title-input",
			attr: { type: "text", "aria-label": t("sessionBar.titleAria") },
		});
		input.value = title;
		heading.hide();
		editButton.hide();

		let settled = false;
		const finish = (commit: boolean): void => {
			if (settled) return;
			settled = true;
			const next = input.value.trim();
			// The input loses focus two ways, and they are not the same event.
			//
			// The writer clicking away is a commit. The panel being rebuilt
			// underneath the input is not: that blur arrives once the input has
			// already been detached, nothing was confirmed, and renaming here
			// would save and re-render from inside the teardown that caused the
			// blur — which is what threw "the node to be removed is no longer a
			// child of this node" out of the emptying loop.
			//
			// Being disconnected from the document separates the two, and in
			// that case there is nothing left to do anyway: the heading and the
			// button this would restore are going away with the panel.
			if (!input.isConnected) return;
			input.remove();
			heading.show();
			editButton.show();
			if (commit && next.length > 0 && next !== title) onRename(next);
		};

		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				finish(true);
			} else if (event.key === "Escape") {
				event.preventDefault();
				finish(false);
			}
		});
		input.addEventListener("blur", () => finish(true));

		input.focus();
		input.select();
	};

	const editButton = iconButton(parent, {
		icon: ICONS.rename,
		label: t("sessionBar.rename"),
		cls: "wb-title-tool",
		onClick: beginEdit,
	});

	// Beside the pencil, because it does the same job — name this conversation —
	// and revealed the same way, because neither is something you reach for
	// often enough to spend permanent space on. A different silhouette, though:
	// two pencils would be two ways to do one thing.
	const wand = iconButton(parent, {
		icon: ICONS.regenerateTitle,
		label: t("sessionBar.regenerateTitle"),
		cls: "wb-title-tool wb-title-wand",
		onClick: () => options.onRegenerateTitle(),
	});
	wand.toggleClass("is-disabled", !options.canRegenerate);

	heading.addEventListener("dblclick", beginEdit);
}
