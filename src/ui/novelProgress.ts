/**
 * The one line both the Settings row and the conversation's status line use
 * for how far a novel-knowledge pass is: "chapter 3/30 · passage 12/153 of
 * this chapter". Empty when the pass has no count yet.
 */

import { t } from "../i18n";
import type { NovelMemoryStatus } from "../memory/NovelMemoryLifecycle";

export function novelProgressText(status: NovelMemoryStatus): string {
	const progress = status.progress;
	if (!progress || progress.total === 0) return "";
	const parts = [t("memory.progress", { done: Math.min(progress.done + 1, progress.total), total: progress.total })];
	if (progress.chunk !== null && progress.chunks !== null && progress.chunks > 1) parts.push(t("memory.chunkProgress", { chunk: progress.chunk, chunks: progress.chunks }));
	return parts.join(" · ");
}
