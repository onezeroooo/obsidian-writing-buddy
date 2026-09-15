/**
 * The manuscript passage attached to a message, rendered as a quoted citation.
 *
 * The label is the *prose*, not the filename. A chip reading `第03章.md · 101 字`
 * says a file was attached; a chip reading `他推门进来时…` says this message was
 * about this writing, which is the thing the writer actually needs to recognise.
 * Clicking the chip returns to the recorded passage in the manuscript.
 *
 * Visually it is a quote, not a button: a left rule and a tint rather than a
 * border and a background.
 */

import { setTooltip } from "obsidian";
import { t } from "../../i18n";
import type { SelectionAttachment } from "../../types";
import { citationPreview } from "../../util/text";

export interface AttachmentChipOptions {
	attachment: SelectionAttachment;
	/** Open the source file and select the recorded range. */
	onOpen: (attachment: SelectionAttachment) => void;
	/** Present only for the composer's active-context strip. */
	onRemove?: () => void;
}

export function renderAttachmentChip(parent: HTMLElement, options: AttachmentChipOptions): HTMLElement {
	const { attachment } = options;
	const wrap = parent.createDiv({ cls: "wb-citation" });

	const body = wrap.createEl("button", {
		cls: "wb-citation-body",
		// aria-label only: Obsidian renders it as the styled tooltip, and a
		// native `title` beside it would hover a second, system-styled copy.
		attr: {
			type: "button",
			"aria-label": t("chip.locate"),
		},
	});
	body.createSpan({ cls: "wb-citation-text", text: citationPreview(attachment.text) });

	body.addEventListener("click", () => {
		options.onOpen(attachment);
	});

	// The remove control lives inside the same surface rather than beside it, so
	// it reads as part of the attachment instead of a detached square button.
	if (options.onRemove) {
		wrap.createSpan({ cls: "wb-citation-count", text: t("chip.charCount", { count: attachment.charCount }) });
		const remove = wrap.createEl("button", {
			cls: "wb-citation-remove",
			text: "×",
			attr: { type: "button", "aria-label": t("chip.removeContext") },
		});
		setTooltip(remove, t("chip.removeContext"), { placement: "top" });
		remove.addEventListener("click", () => {
			options.onRemove?.();
		});
	}

	return wrap;
}

/**
 * Compatibility hook for the view teardown path. Attachment chips no longer
 * create document-level popovers, so there is nothing to clean up.
 */
export function clearAttachmentPopovers(): void {
	// Intentionally empty. Remove this shim with the remaining caller.
}
