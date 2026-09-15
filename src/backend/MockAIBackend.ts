/**
 * A deterministic in-process backend.
 *
 * It exists for two reasons: automated tests need a backend that cannot reach
 * the network, and sideload acceptance must not be blocked on the real Remote
 * AI Runtime being finished. It emits the same event contract as
 * `RemoteAIBackend`, so anything that works against it works against a real
 * server too.
 *
 * Its rewrites apply small, predictable substitutions. That is enough to prove
 * the whole local path — candidate → diff → stale check → apply → undo — is
 * wired correctly, without pretending to be a language model.
 */

import type {
	AIBackend,
	AIEvent,
	Capabilities,
	HealthResult,
	RewritePayload,
	TurnPayload,
} from "./AIBackend";
import { countChars } from "../util/text";
import { CANDIDATE_FENCE_LABEL } from "../editing/rewriteParser";
import type { SkillAction } from "../types";

/** Actions whose reply is expected to carry a passage. Mirrors skillRouting. */
function producesPassage(action: SkillAction | undefined): boolean {
	return action === "rewrite" || action === "continue";
}

export interface MockAIBackendOptions {
	/** Milliseconds between streamed chunks. Zero in tests. */
	chunkDelayMs?: number;
	/** Force every request to fail, to exercise error handling. */
	failWith?: string;
}

/** Substitutions used to simulate a polish pass over Chinese prose. */
const POLISH_SUBSTITUTIONS: Array<[string, string]> = [
	["看向", "望向"],
	["很", "十分"],
	["马上", "旋即"],
	["忽然", "蓦地"],
	["说道", "开口"],
];

export class MockAIBackend implements AIBackend {
	readonly displayName = "Mock backend (offline)";

	private readonly chunkDelayMs: number;
	private readonly failWith: string | undefined;
	private readonly cancelled = new Set<string>();

	constructor(options: MockAIBackendOptions = {}) {
		this.chunkDelayMs = options.chunkDelayMs ?? 0;
		this.failWith = options.failWith;
	}

	async health(): Promise<HealthResult> {
		if (this.failWith) return { ok: false, status: "error", detail: this.failWith };
		return { ok: true, status: "ok", version: "mock-1", detail: "Local mock backend; no network access." };
	}

	async getCapabilities(): Promise<Capabilities> {
		return {
			providers: [
				{
					id: "mock",
					label: "Mock provider",
					default: true,
					models: [
						{ id: "mock-standard", label: "Mock Standard", default: true },
						{ id: "mock-long", label: "Mock Long-form" },
					],
					efforts: [
						{ id: "low", label: "Low" },
						{ id: "medium", label: "Medium", default: true },
						{ id: "high", label: "High" },
					],
				},
			],
			modes: ["chat", "rewrite"],
			streaming: true,
			defaultProvider: "mock",
		};
	}

	async *chat(request: TurnPayload): AsyncIterable<AIEvent> {
		yield { type: "request.started", requestId: request.requestId };
		if (this.failWith) {
			yield { type: "error", message: this.failWith, code: "mock" };
			yield { type: "done" };
			return;
		}
		yield { type: "provider.selected", provider: "mock", model: request.model ?? "mock-standard", effort: request.effort ?? "medium" };

		// Facts about the run are activity, not prose. They belong behind
		// 查看活动 rather than at the top of the answer.
		for (const step of describeChatSteps(request)) {
			yield { type: "activity", label: step };
		}

		const answer = this.composeChatAnswer(request);
		for (const chunk of chunkText(answer)) {
			if (this.cancelled.has(request.requestId)) break;
			await this.pause();
			yield { type: "content.delta", text: chunk };
		}

		if (this.cancelled.delete(request.requestId)) {
			yield { type: "activity", label: "已取消" };
			yield { type: "done" };
			return;
		}

		yield { type: "usage", usage: { inputTokens: countChars(answer), outputTokens: countChars(answer) } };
		yield { type: "result", result: { text: answer } };
		yield { type: "done" };
	}

	async *rewrite(request: RewritePayload): AsyncIterable<AIEvent> {
		yield { type: "request.started", requestId: request.requestId };
		if (this.failWith) {
			yield { type: "error", message: this.failWith, code: "mock" };
			yield { type: "done" };
			return;
		}
		yield { type: "provider.selected", provider: "mock", model: request.model ?? "mock-standard", effort: request.effort ?? "medium" };
		if (request.skill) {
			yield { type: "activity", label: `应用技能：${request.skill.name}` };
		}
		yield { type: "activity", label: "正在组织改写…" };

		await this.pause();
		if (this.cancelled.delete(request.requestId)) {
			yield { type: "activity", label: "已取消" };
			yield { type: "done" };
			return;
		}

		const replacement = this.composeReplacement(request);
		// Only the final result matters for a rewrite; the plugin never applies
		// partial deltas to the manuscript.
		yield { type: "result", result: { replacement } };
		yield { type: "done" };
	}

	async cancel(requestId: string): Promise<void> {
		this.cancelled.add(requestId);
	}

	// -----------------------------------------------------------------------

	/**
	 * The answer only.
	 *
	 * What was read and which skill ran are reported as `activity` events, so
	 * they end up behind 查看活动 instead of at the top of the prose where they
	 * competed with the writing.
	 */
	private composeChatAnswer(request: TurnPayload): string {
		const lastUser = [...request.messages].reverse().find((message) => message.role === "user");
		const question = lastUser?.content.trim() ?? "";

		// A writing action is a conversation: the reply says something and puts
		// the finished passage in a fenced block, which is what the diff and 应用
		// act on. The mock has to answer in that shape or the offline path stops
		// exercising candidate → diff → apply → undo at all.
		if (request.selection && producesPassage(request.skill?.action)) {
			return [
				`关于「${question}」：这是离线模拟改写，正文尚未改动。`,
				"",
				`\`\`\`${CANDIDATE_FENCE_LABEL}`,
				this.composeReplacementCore(request.selection.text, request.skill?.id ?? ""),
				"```",
			].join("\n");
		}

		return question.length > 0
			? `关于「${question}」：这是离线模拟回答，未修改任何正文。`
			: "这是离线模拟回答，未修改任何正文。";
	}

	private composeReplacement(request: RewritePayload): string {
		return this.composeReplacementCore(request.selection.text, request.skill?.id ?? "");
	}

	private composeReplacementCore(original: string, skillId: string): string {
		if (skillId === "shorten") {
			// Keep the first sentence only.
			const firstSentence = /^[^。！？!?]*[。！？!?]?/.exec(original)?.[0];
			return firstSentence && firstSentence.length > 0 ? firstSentence : original;
		}
		if (skillId === "expand") {
			return `${original}远处的声音又响了一遍，像是提醒着什么。`;
		}
		// Only the continuation — which is what the skill asks for and what a real
		// Runtime returns. Echoing the original back here is exactly what hid the
		// bug where applying a continuation deleted the selected passage.
		if (skillId === "continue") {
			return "她没有回头，只是把手按在了门框上。";
		}

		let polished = original;
		for (const [from, to] of POLISH_SUBSTITUTIONS) {
			polished = polished.split(from).join(to);
		}
		if (polished === original) {
			// Guarantee a visible change so the diff view is exercised even when
			// none of the substitutions matched.
			polished = original.replace(/。/, "，");
		}
		return polished;
	}

	private pause(): Promise<void> {
		if (this.chunkDelayMs <= 0) return Promise.resolve();
		return new Promise((resolve) => setTimeout(resolve, this.chunkDelayMs));
	}
}

/** Split into small chunks so streaming is visible in the UI. */
function chunkText(text: string, size = 12): string[] {
	const chars = Array.from(text);
	const chunks: string[] = [];
	for (let i = 0; i < chars.length; i += size) {
		chunks.push(chars.slice(i, i + size).join(""));
	}
	return chunks;
}

/**
 * Truthful progress steps for a chat turn.
 *
 * Each line describes something this backend genuinely did. It does not claim
 * to have consulted a character sheet or a timeline, because it did not.
 */
function describeChatSteps(request: TurnPayload): string[] {
	const steps: string[] = [];
	const selection = request.selection;
	if (selection) {
		steps.push(`正在读取所选正文…（${countChars(selection.text)} 字）`);
	}
	if (request.currentFile) {
		steps.push(`当前文件：${request.currentFile}`);
	}
	if (request.skill) {
		steps.push(`应用技能：${request.skill.name}`);
	}
	steps.push("正在组织回答…");
	return steps;
}
