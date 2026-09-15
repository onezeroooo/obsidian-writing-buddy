/**
 * Naming a conversation.
 *
 * Two rules, in this order.
 *
 * **A conversation is never nameless.** The moment the first message is sent —
 * before any answer exists — it already carries a title built from what the
 * writer was working on: the chapter heading they were inside, or the file, plus
 * their own words. `新会话` in a list of forty conversations is a row that has to
 * be opened to be identified, which is the whole problem history is meant to fix.
 *
 * **The good title arrives later, and costs nothing.** Once the first answer
 * lands, a cheap minimum-effort request replaces the fallback with something
 * that reads like a chapter note. It runs after the answer is on screen, so it
 * cannot delay a single token, and a failure simply leaves the fallback alone.
 *
 * Length is tuned for Chinese: long enough to carry a little chapter identity —
 * a few characters more than a typical chat app — and short enough to stay on
 * one line.
 */

import { truncateChars } from "../util/text";
import type { SelectionAttachment } from "../types";
import { instructionLocale, t } from "../i18n";

/**
 * The stored sentinel for a conversation that has not been named yet.
 *
 * It is a value in synced project data, so it never changes with the
 * interface language; `displayTitle` turns it into the reader's words.
 */
export const UNTITLED = "未命名对话";

/** What to show for a title: the sentinel becomes a localized placeholder. */
export function displayTitle(title: string): string {
	return title === UNTITLED ? t("session.untitled") : title;
}

/** Target length. Longer than a chat app's, short of a sentence. */
export const TITLE_TARGET_CHARS = 24;

/** Hard ceiling, including anything the model returns. */
export const TITLE_MAX_CHARS = 32;

/** Separates the chapter identity from what the conversation is about. */
export const TITLE_SEPARATOR = "｜";

/**
 * The heading a line sits under, e.g. `听雨楼` for a line below `## 听雨楼`.
 *
 * Markdown headings only — a manuscript's own structure, not an invented one.
 * Returns the nearest preceding heading at any level, which is the most
 * specific thing the writer can see above their cursor.
 */
export function nearestHeading(text: string, line: number): string | null {
	const lines = text.split(/\r?\n/);
	const limit = Math.min(line, lines.length - 1);
	let inFence = false;

	let found: string | null = null;
	for (let index = 0; index <= limit; index += 1) {
		const current = lines[index] ?? "";
		if (/^\s*```/.test(current)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		const match = /^\s{0,3}(#{1,6})\s+(.*\S)\s*$/.exec(current);
		if (match) found = match[2].trim();
	}
	return found;
}

/** Drop the extension: `第三章.md` is a file, `第三章` is a chapter. */
export function chapterName(fileName: string): string {
	return fileName.replace(/\.md$/i, "");
}

export interface FallbackTitleInput {
	/** The writer's first message. */
	question: string;
	/** Nearest Markdown heading above the selection, if any. */
	heading?: string | null;
	/** The attached passage, used for its file name. */
	selection?: SelectionAttachment | null;
	/** The chapter the writer is in, when nothing is attached. */
	currentFile?: string | null;
}

/**
 * A useful title before any answer exists.
 *
 * Priority is heading, then file, then nothing — each combined with the gist of
 * what the writer actually asked. It never invents a topic: every part of the
 * result is text the writer typed or a name from their own vault.
 */
export function fallbackTitle(input: FallbackTitleInput): string {
	const gist = questionGist(input.question);
	const context = titleContext(input);

	if (!context) return capped(gist);
	if (!gist) return capped(context);

	// The context prefix is capped first so a long chapter name cannot crowd out
	// what the conversation is actually about. The whole line is capped again at
	// the end: `truncateChars` adds an ellipsis, which is itself a character, so
	// budgeting the two halves separately overruns by one.
	const prefix = truncateChars(context, 10);
	const room = TITLE_TARGET_CHARS - Array.from(prefix).length - TITLE_SEPARATOR.length;
	const line = `${prefix}${TITLE_SEPARATOR}${truncateChars(gist, Math.max(6, room))}`;
	return capped(line);
}

/**
 * Clip to the target length, ellipsis included.
 *
 * `truncateChars` appends the ellipsis *after* its limit, so asking it for the
 * target directly yields one character more than the target.
 */
function capped(text: string): string {
	return truncateChars(text, TITLE_TARGET_CHARS - 1);
}

/** The chapter identity available for a title, most specific first. */
function titleContext(input: Partial<FallbackTitleInput>): string {
	const heading = input.heading?.trim();
	if (heading) return heading;
	const fileName = input.selection?.fileName ?? (input.currentFile ? input.currentFile.split("/").pop() : null);
	return fileName ? chapterName(fileName) : "";
}

/** The first clause of the question, collapsed onto one line. */
export function questionGist(question: string): string {
	const cleaned = question.replace(/\s+/g, " ").trim();
	if (cleaned.length === 0) return "";
	const firstClause = cleaned.split(/[。！？!?；;]/)[0] || cleaned;
	// A prompt ending in a colon is an opening the writer filled in after it.
	return firstClause.replace(/[：:]\s*$/, "").trim();
}

/** One turn, as the title prompt sees it. */
export interface TitleTurn {
	role: "user" | "assistant";
	text: string;
}

/**
 * The request that produces the real title.
 *
 * Deliberately one short user message with the material inlined rather than a
 * context payload: this is the cheapest call the plugin makes, and it should
 * stay that way.
 *
 * A branch says so explicitly. Without that the model reaches for the general
 * subject of the exchange, which for a branch is the thing it has in common
 * with its parent and its siblings — exactly the wrong answer.
 */
export function titlePrompt(input: {
	turns: TitleTurn[];
	branched?: boolean;
	heading?: string | null;
	fileName?: string | null;
}): string {
	const en = instructionLocale() === "en";
	const where = [
		input.fileName ? `${en ? "File" : "文件"}：${chapterName(input.fileName)}` : "",
		input.heading ? `${en ? "Section" : "章节"}：${input.heading}` : "",
	].filter((part) => part.length > 0);

	const transcript = input.turns.map(
		(turn) =>
			`${turn.role === "user" ? (en ? "Writer" : "作者") : (en ? "Assistant" : "助手")}：${truncateChars(
				turn.text.replace(/\s+/g, " ").trim(),
				turn.role === "user" ? 220 : 320,
			)}`,
	);

	// The chapter is prepended afterwards, so asking for it here as well
	// produced `第05章追问中林昭克制感扩写` — the same information twice, run
	// together, with no room left for the actual subject.
	const lines = en
		? [
				input.branched
					? "Below are the most recent turns of a branch of a writing conversation. Give this branch a title."
					: "Below are the most recent turns of a writing conversation. Give the conversation a title.",
				"",
				...where,
				"",
				...transcript,
				"",
				input.branched
					? "This branch split off from another conversation. Name it from the turns above only, and bring out what makes it different from the conversation it left."
					: "Name it from the turns above, reflecting what is mainly being discussed now.",
				"Requirements: English, 3 to 6 words, one line, only what this conversation is about.",
				"Do not include the chapter or file name; that is added in front automatically.",
				"No quotation marks, no trailing punctuation, not a full sentence.",
				"Output the title only.",
			]
		: [
				input.branched
					? "下面是一个分支对话最近的几轮内容。给这个分支起一个标题。"
					: "下面是一段写作对话最近的几轮内容。给这段对话起一个标题。",
				"",
				...where,
				"",
				...transcript,
				"",
				input.branched
					? "这个分支是从另一段对话中分出来的，请只根据上面这些内容命名，突出它和原对话不同的地方。"
					: "请根据上面这些内容命名，体现现在主要在讨论什么。",
				"要求：中文，8 到 16 个字，一行，只说这段对话在讨论什么。",
				"不要写章节名或文件名，那部分会自动加在前面。",
				"不要加引号、书名号或标点结尾，不要写成一句总结。",
				"只输出标题本身。",
			];
	return lines.join("\n");
}

/**
 * Clean up whatever the model returned.
 *
 * Models like to wrap a title in quotes, prefix it with `标题：`, or hand back a
 * whole sentence. Returns null when nothing usable survives, in which case the
 * fallback title stays — a wrong title is worse than a plain one.
 */
export function sanitizeGeneratedTitle(raw: string): string | null {
	const firstLine = raw.split(/\r?\n/).find((line) => line.trim().length > 0);
	if (!firstLine) return null;

	const stripped = firstLine
		.trim()
		.replace(/^(标题|title)\s*[:：]\s*/i, "")
		.replace(/^[「『“"'‘《【[]+/u, "")
		.replace(/[」』”"'’》】\]]+$/u, "")
		.replace(/[。.!！?？，,、；;]+$/u, "")
		.trim();

	if (stripped.length === 0) return null;
	return truncateChars(stripped, TITLE_MAX_CHARS);
}

/**
 * Put the chapter in front of a generated title.
 *
 * A conversation is about a passage, and a list of conversations is unusable
 * without knowing which chapter each one belongs to — `林昭克制感扩写` could be
 * any of five. The model is told not to include it precisely so this can, once,
 * in a consistent place and with a consistent separator.
 *
 * Skipped when the title already names the chapter, which a model will
 * occasionally do anyway; the point is one mention, not a rule about who adds
 * it.
 */
export function withChapter(title: string, context: { heading?: string | null; fileName?: string | null }): string {
	const prefix = titleContext({ question: "", ...context });
	if (prefix.length === 0) return capped(title);
	if (title.includes(prefix)) return capped(title);

	const short = truncateChars(prefix, 10);
	const room = TITLE_TARGET_CHARS - Array.from(short).length - TITLE_SEPARATOR.length;
	return capped(`${short}${TITLE_SEPARATOR}${truncateChars(title, Math.max(6, room))}`);
}
