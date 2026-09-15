/**
 * Icon names and small DOM helpers.
 *
 * Names are Lucide ids, which is what Obsidian's `setIcon` resolves, so the
 * plugin inherits the app's icon set and theming instead of shipping assets.
 */

import { setIcon, setTooltip } from "obsidian";

export const ICONS = {
	/** Plugin identity: an assistant, not a pencil. */
	brand: "bot",
	/** A bare plus. The title row has no room for a worded button. */
	newConversation: "plus",
	/** Sits before the conversation title, so the row reads as a conversation. */
	conversation: "message-square",
	history: "history",
	more: "more-horizontal",
	rename: "pencil",
	/**
	 * Rename a conversation from what it has become.
	 *
	 * Sparkles rather than a wand: a wand at 12px is a pencil with a dot on it,
	 * and it sits directly beside the actual pencil.
	 */
	regenerateTitle: "sparkles",
	send: "arrow-up",
	stop: "square",
	branch: "git-branch",
	/** Navigating from a branch back to the conversation it came from. */
	parent: "corner-left-up",
	attachment: "file-text",
	search: "search",
	collapsed: "chevron-right",
	expanded: "chevron-down",
	/** Arrows pointing outward: open everything. */
	expandAll: "chevrons-up-down",
	/** Arrows folding inward: close everything. */
	collapseAll: "chevrons-down-up",
	skills: "sparkles",
	settings: "settings",
	/** Opens the release page. An outward link, so the outward-link glyph. */
	releaseNotes: "external-link",
	archive: "archive",
	unarchive: "archive-restore",
	/** Permanent removal. Deliberately the only destructive icon in the set. */
	remove: "trash-2",
	showArchived: "eye",
	hideArchived: "eye-off",
	apply: "check",
	undo: "rotate-ccw",
	copy: "copy",
} as const;

export interface IconButtonOptions {
	icon: string;
	/** The accessible name, and the tooltip unless one is suppressed. */
	label: string;
	cls?: string;
	/**
	 * Set false where a tooltip would land on top of the control it describes.
	 * The accessible name is kept either way — this is about the dark block
	 * Obsidian paints, not about labelling.
	 */
	tooltip?: boolean;
	onClick: (event: MouseEvent) => void;
}

/**
 * An icon-only button that is still reachable without a mouse.
 *
 * Every icon control gets `aria-label` and a tooltip: an unlabelled glyph is
 * unusable with a screen reader and merely a guess with one.
 */
export function iconButton(parent: HTMLElement, options: IconButtonOptions): HTMLButtonElement {
	const button = parent.createEl("button", {
		cls: `wb-icon-btn${options.cls ? ` ${options.cls}` : ""}`,
		attr: { "aria-label": options.label, type: "button" },
	});
	setIcon(button, options.icon);
	if (options.tooltip !== false) setTooltip(button, options.label, { placement: "top" });
	button.addEventListener("click", options.onClick);
	return button;
}

/** A decorative icon inside another control. Hidden from assistive tech. */
export function iconSpan(parent: HTMLElement, icon: string, cls?: string): HTMLElement {
	const span = parent.createSpan({ cls: cls ?? "wb-icon", attr: { "aria-hidden": "true" } });
	setIcon(span, icon);
	return span;
}
