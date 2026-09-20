import type {
	AIBackend,
	AIEvent,
	Capabilities,
	HealthResult,
	RewritePayload,
	TurnPayload,
	UsageInfo,
} from "./AIBackend";
import type { LocalConnection } from "../connections/types";
import { adapterInstructions, adapterMessages, rewriteMessages, withSystemMessage } from "./requestText";
import { fetchHttpClient, type HttpClient } from "./HttpClient";
import { unsafeVaultPathMessage } from "./safePath";
import { t } from "../i18n";
import { fullEffortLadder, isOllamaLevelledThinkingFamily, ollamaThink } from "./effort";



export class OllamaBackend implements AIBackend {
	readonly displayName: string;
	private readonly baseUrl: string;
	private readonly httpClient: HttpClient;
	private readonly inFlight = new Map<string, AbortController>();
	private readonly cancelled = new Set<string>();

	constructor(connection: LocalConnection, fetchImpl?: typeof fetch, httpClient?: HttpClient) {
		this.displayName = connection.name;
		this.baseUrl = connection.config.baseUrl.replace(/\/+$/, "");
		this.httpClient = httpClient ?? fetchHttpClient(fetchImpl);
	}

	async health(): Promise<HealthResult> {
		try {
			await this.models();
			return { ok: true, status: "ok" };
		} catch (error) {
			return { ok: false, status: "unreachable", detail: describe(error) };
		}
	}

	async getCapabilities(): Promise<Capabilities> {
		const models = await this.models();
		// Effort is offered only where Ollama's `think` takes a level: a model
		// the server reports as thinking-capable and of a family that reads one.
		// Other thinking models take `think` as a flag, which Ollama already
		// sets for them; a control that changed nothing would be a false one.
		const levelled = await Promise.all(models.map(async (id) => isOllamaLevelledThinkingFamily(id) && await this.thinks(id)));
		const mapped = models.map((id, index) => ({ id, efforts: levelled[index] ? fullEffortLadder() : [] }));
		return {
			providers: [{ id: "local", label: "Local", models: mapped, efforts: mapped.some((model) => model.efforts.length > 0) ? fullEffortLadder() : [] }],
			modes: ["chat", "rewrite"],
			streaming: false,
		};
	}

	chat(payload: TurnPayload): AsyncIterable<AIEvent> { return this.generate(payload, false); }
	rewrite(payload: RewritePayload): AsyncIterable<AIEvent> { return this.generate(payload, true); }
	async cancel(requestId: string): Promise<void> {
		const controller = this.inFlight.get(requestId);
		if (!controller) return;
		this.cancelled.add(requestId);
		controller.abort();
	}

	private async models(): Promise<string[]> {
		const response = await this.httpClient({ url: this.baseUrl + "/api/tags" });
		if (!response.ok) throw new Error("Ollama HTTP " + response.status);
		const raw = response.json as Record<string, unknown>;
		return Array.isArray(raw.models)
			? raw.models.flatMap((item) => {
				const record = typeof item === "object" && item !== null ? item as Record<string, unknown> : {};
				return typeof record.name === "string" ? [record.name] : [];
			})
			: [];
	}

	/** Whether `/api/show` lists `thinking` among the model's capabilities. A failed lookup counts as no. */
	private async thinks(model: string): Promise<boolean> {
		try {
			const response = await this.httpClient({
				url: this.baseUrl + "/api/show",
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ model }),
			});
			if (!response.ok) return false;
			const capabilities = object(response.json).capabilities;
			return Array.isArray(capabilities) && capabilities.includes("thinking");
		} catch {
			return false;
		}
	}

	private async *generate(payload: TurnPayload | RewritePayload, rewrite: boolean): AsyncIterable<AIEvent> {
		if (payload.provider !== "local") {
			yield { type: "error", code: "provider_unavailable", message: t("backend.providerNotOnConnection") };
			yield { type: "done" };
			return;
		}
		if (!payload.model) {
			yield { type: "error", code: "model_required", message: t("backend.modelRequired") };
			yield { type: "done" };
			return;
		}
		const controller = new AbortController();
		this.inFlight.set(payload.requestId, controller);
		try {
			yield { type: "request.started", requestId: payload.requestId };
			const messages = rewrite
				? rewriteMessages(payload as RewritePayload)
				: adapterMessages(payload);
			const think = isOllamaLevelledThinkingFamily(payload.model) ? ollamaThink(payload.effort) : undefined;
			yield { type: "provider.selected", provider: "local", model: payload.model, ...(think ? { effort: payload.effort ?? undefined } : {}) };
			const response = await this.httpClient({
				url: this.baseUrl + "/api/chat",
				method: "POST",
				signal: controller.signal,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					model: payload.model,
					stream: false,
					messages: withSystemMessage(adapterInstructions(payload), messages),
					...(think ? { think } : {}),
				}),
			});
			if (!response.ok) throw new Error("Ollama HTTP " + response.status + "：" + response.text.slice(0, 200));
			const raw = object(response.json);
			if (this.cancelled.delete(payload.requestId) || controller.signal.aborted) return;
			const message = typeof raw.message === "object" && raw.message !== null ? raw.message as Record<string, unknown> : {};
			const text = typeof message.content === "string" ? message.content : "";
			const doneReason = typeof raw.done_reason === "string" ? raw.done_reason : undefined;
			if (isOutputBudgetExhausted(doneReason)) {
				yield { type: "error", code: "output_budget_exhausted", message: t("backend.outputBudget") };
				return;
			}
			if (!text.trim()) {
				yield { type: "error", code: "local_empty_response", message: t("backend.localEmpty") };
				return;
			}
			const usage: UsageInfo = {
				...(typeof raw.prompt_eval_count === "number" ? { inputTokens: raw.prompt_eval_count } : {}),
				...(typeof raw.eval_count === "number" ? { outputTokens: raw.eval_count } : {}),
			};
			if (Object.keys(usage).length > 0) {
				yield { type: "usage", usage };
				if (this.cancelled.delete(payload.requestId) || controller.signal.aborted) return;
			}
			yield {
				type: "result",
				result: rewrite ? { replacement: text } : { text },
				metadata: {
					provider: "local",
					model: payload.model,
					...(think && payload.effort ? { effort: payload.effort } : {}),
					...(Object.keys(usage).length > 0 ? { usage } : {}),
				},
			};
		} catch (error) {
			if (this.cancelled.delete(payload.requestId) || controller.signal.aborted || isAbortError(error)) return;
			const message = describe(error);
			yield { type: "error", code: message === unsafeVaultPathMessage() ? "invalid_request" : "local_unavailable", message };
		} finally {
			this.cancelled.delete(payload.requestId);
			this.inFlight.delete(payload.requestId);
			yield { type: "done" };
		}
	}
}

function describe(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function isAbortError(error: unknown): boolean { return error instanceof Error && error.name === "AbortError"; }
function object(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}; }
function isOutputBudgetExhausted(reason: string | undefined): boolean {
	const normalized = reason?.trim().toLowerCase().replace(/[\s-]+/g, "_");
	return normalized === "length" || normalized === "max_tokens";
}
