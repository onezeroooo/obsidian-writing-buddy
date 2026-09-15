/**
 * Naming a conversation after what it has become.
 *
 * Runs on its own, not through `ConversationController`: the controller owns
 * exactly one in-flight request so that Stop cancels the right thing, and a
 * background title must never take that slot from the answer the writer is
 * reading. It reuses the conversation's explicit Connection, Provider, Model,
 * and Effort, with one short message and no vault documents.
 *
 * Two decisions here matter more than the prompt.
 *
 * **A branch is named from its own discussion.** Everything before the split is
 * identical in the parent and in every sibling, so summarising it would name
 * them all after the conversation they diverged from — precisely the thing a
 * list of branches has to tell apart.
 *
 * **A title is refreshed, not recomputed.** After the first exchange it is
 * named; after that it is renamed only once enough new discussion has piled up
 * that it is plausibly about something else. A title that changes every turn is
 * noise in a list, and one that never changes stops being true.
 */

import { t } from "../i18n";
import type { AIBackend } from "../backend/AIBackend";
import { createRequestId } from "../util/id";
import { sanitizeGeneratedTitle, titlePrompt, withChapter, type TitleTurn } from "./titles";
import type { ConversationSession, SelectionAttachment } from "../types";
import { conversationMessageText } from "./messageText";

/** How many recent turns a title is summarised from. */
export const TITLE_WINDOW = 6;

/** How many new messages must arrive before a title is reconsidered. */
export const RETITLE_AFTER_MESSAGES = 6;

/** What a title should be summarised from, and whether it is worth doing. */
export interface TitleMaterial {
	/** The recent exchange, oldest first. */
	turns: TitleTurn[];
	/** True when these turns are a branch's own discussion. */
	branched: boolean;
	/** The most recent passage discussed, for chapter context. */
	lastSelection: SelectionAttachment | null;
	/** True when there is enough new material to justify a rename. */
	shouldRetitle: boolean;
}

/**
 * Choose what to name a conversation from.
 *
 * `titledAt` is how many messages the conversation had when it was last named;
 * absent means never. The first exchange always earns a title, and after that a
 * rename waits for `RETITLE_AFTER_MESSAGES` more.
 */
export function titleMaterial(session: ConversationSession, titledAt?: number): TitleMaterial {
	// A branch's own discussion starts after the message it was taken from —
	// everything up to and including that point is the parent's.
	const start = session.branchedFrom ? session.branchedFrom.messageIndex + 1 : 0;
	const own = session.messages.slice(start);
	const window = own.slice(-TITLE_WINDOW);

	const lastSelection =
		[...own].reverse().find((message) => message.selection)?.selection ?? null;

	const named = titledAt ?? 0;
	const shouldRetitle =
		own.length >= 2 && (named === 0 || session.messages.length - named >= RETITLE_AFTER_MESSAGES);

	return {
		turns: window.map((message) => ({ role: message.role, text: conversationMessageText(message) })),
		branched: session.branchedFrom !== undefined,
		lastSelection,
		shouldRetitle,
	};
}

export interface TitleRequest {
	turns: TitleTurn[];
	branched: boolean;
	heading?: string | null;
	fileName?: string | null;
	connectionId: string;
	provider: string;
	model?: string | undefined;
	effort?: string | undefined;
}

/**
 * The outcome, with a reason when there is no title.
 *
 * A failure here is invisible to the writer by design — the conversation keeps
 * its name and nothing interrupts them. That is also precisely how it can stay
 * broken for weeks, so the reason is returned rather than swallowed, and the
 * caller records it where a developer can find it.
 */
export type TitleResult = { ok: true; title: string } | { ok: false; reason: string };

/** Generate a title, or explain why not. Never throws. */
export async function generateTitle(backend: AIBackend, request: TitleRequest): Promise<TitleResult> {
	if (request.turns.length === 0) return { ok: false, reason: t("session.noSummaryContent") };
	try {
		let text = "";
		let failure: string | null = null;

		for await (const event of backend.chat({
			requestId: createRequestId(),
			connectionId: request.connectionId,
			conversationId: "title",
			provider: request.provider,
			model: request.model ?? null,
			// Passed through exactly as a turn passes it. Nulling `auto` here read
			// as "no preference", but routing treats an absent Effort on a model
			// that offers one as an error — so every conversation whose Effort was
			// `auto`, which is the value choosing a Model assigns, failed to be
			// named. The wand said so; automatic naming failed in the log.
			effort: request.effort ?? null,
			messages: [
				{
					role: "user",
					content: titlePrompt({
						turns: request.turns,
						branched: request.branched,
						...(request.heading !== undefined ? { heading: request.heading } : {}),
						...(request.fileName !== undefined ? { fileName: request.fileName } : {}),
					}),
				},
			],
		})) {
			if (event.type === "content.delta") text += event.text;
			if (event.type === "result" && "text" in event.result) text = event.result.text;
			if (event.type === "error") failure = event.message;
		}

		if (failure) return { ok: false, reason: t("session.backendError", { reason: failure }) };
		if (text.trim().length === 0) return { ok: false, reason: t("session.noTextReturned") };

		const title = sanitizeGeneratedTitle(text);
		if (!title) return { ok: false, reason: t("session.notATitle", { text: text.slice(0, 80) }) };

		// The chapter goes on here rather than being asked for in the prompt, so
		// every title carries it, in the same place, with the same separator.
		return {
			ok: true,
			title: withChapter(title, {
				...(request.heading !== undefined ? { heading: request.heading } : {}),
				...(request.fileName !== undefined ? { fileName: request.fileName } : {}),
			}),
		};
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : String(error) };
	}
}
