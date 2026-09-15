import type {
	AIBackend,
	AIEvent,
	Capabilities,
	HealthResult,
	RewritePayload,
	TurnPayload,
	UsageInfo,
} from "./AIBackend";
import type { DirectAPIConnection, DirectAPIProvider } from "../connections/types";
import { providerOf, requiresApiKey } from "../connections/providers";
import { adapterInstructions, adapterMessages, rewriteMessages, withSystemMessage, type AdapterMessage } from "./requestText";
import { fetchHttpClient, type HttpClient } from "./HttpClient";
import { MAX_REPLY_CHARS, ReplyTooLargeError, StreamInterruptedError, StreamUnavailableError, isEventStream, sseData, type StreamClient } from "./streaming";
import { redactCredential } from "../auth/redact";
import { unsafeVaultPathMessage } from "./safePath";
import { t } from "../i18n";

export interface DirectAPIBackendOptions {
	connection: DirectAPIConnection;
	fetchImpl?: typeof fetch;
	httpClient?: HttpClient;
	/** When given, replies are streamed through it; without one they arrive whole through the HTTP client. */
	streamClient?: StreamClient;
}



interface Completion {
	text: string;
	finishReason?: string;
	usage?: UsageInfo;
}

/**
 * One entry of a model listing. `efforts` is what the endpoint said about
 * reasoning effort for this model: a ladder it advertised, an empty list when
 * it explicitly declared none, and `undefined` when it said nothing at all.
 */
export interface DiscoveredModel {
	id: string;
	efforts?: string[];
}

export class DirectAPIBackend implements AIBackend {
	readonly displayName: string;
	private readonly connection: DirectAPIConnection;
	private readonly httpClient: HttpClient;
	private readonly streamClient: StreamClient | undefined;
	/** Set once a stream could not be opened, so later turns go straight to the whole-reply path. */
	private streamingBlocked = false;
	private readonly inFlight = new Map<string, AbortController>();
	private readonly cancelled = new Set<string>();

	constructor(options: DirectAPIBackendOptions) {
		this.connection = options.connection;
		this.displayName = options.connection.name;
		this.httpClient = options.httpClient ?? fetchHttpClient(options.fetchImpl);
		this.streamClient = options.streamClient;
	}

	async health(): Promise<HealthResult> {
		try {
			await this.discoverModels(true);
			return { ok: true, status: "ok" };
		} catch (error) {
			const detail = redactCredential(describe(error), this.connection.config.apiKey);
			return {
				ok: false,
				status: isAuthError(detail) ? "unauthorized" : "unreachable",
				detail,
			};
		}
	}

	async getCapabilities(): Promise<Capabilities> {
		const models = await this.discoverModels();
		const provider = this.connection.config.provider;
		const mapped = models.map((model) => ({ id: model.id, efforts: directEfforts(provider, model.id, model.efforts) }));
		const efforts = uniqueEfforts(mapped.flatMap((model) => model.efforts ?? []));
		// A direct connection carries exactly one provider, and the writer knows
		// it by the name they gave the connection — "Tidewire", not the adapter.
		return {
			providers: [{
				id: provider,
				label: this.connection.name,
				models: mapped,
				efforts,
			}],
			modes: ["chat", "rewrite"],
			streaming: this.streamClient !== undefined,
		};
	}

	chat(payload: TurnPayload): AsyncIterable<AIEvent> {
		return this.generate(payload, false);
	}

	rewrite(payload: RewritePayload): AsyncIterable<AIEvent> {
		return this.generate(payload, true);
	}

	async cancel(requestId: string): Promise<void> {
		const controller = this.inFlight.get(requestId);
		if (!controller) return;
		this.cancelled.add(requestId);
		controller.abort();
	}

	private async *generate(payload: TurnPayload | RewritePayload, rewrite: boolean): AsyncIterable<AIEvent> {
		if (payload.provider !== this.connection.config.provider) {
			yield { type: "error", code: "provider_unavailable", message: t("backend.providerNotOnConnection") };
			yield { type: "done" };
			return;
		}
		const model = payload.model;
		if (!model) {
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
			yield {
				type: "provider.selected",
				provider: this.connection.config.provider,
				model,
				...(payload.effort ? { effort: payload.effort } : {}),
			};
			const instructions = adapterInstructions(payload);
			let result: Completion;
			if (this.streamClient && !this.streamingBlocked) {
				// Stream when possible; a stream that cannot be opened at all falls
				// back to the whole reply, and stays there for this connection.
				let streamed = "";
				const stream = this.streamCompletion(this.streamClient, model, messages, instructions, payload.effort, controller.signal);
				try {
					let next = await stream.next();
					while (!next.done) {
						streamed += next.value;
						yield { type: "content.delta", text: next.value };
						if (this.cancelled.has(payload.requestId) || controller.signal.aborted) return;
						next = await stream.next();
					}
					result = next.value;
				} catch (error) {
					if (!(error instanceof StreamUnavailableError) || streamed) throw error;
					this.streamingBlocked = true;
					result = await this.complete(model, messages, instructions, payload.effort, controller.signal);
				}
			} else {
				result = await this.complete(model, messages, instructions, payload.effort, controller.signal);
			}
			if (this.cancelled.delete(payload.requestId) || controller.signal.aborted) return;
			if (isOutputBudgetExhausted(result.finishReason)) {
				yield { type: "error", code: "output_budget_exhausted", message: t("backend.outputBudget") };
				return;
			}
			if (!result.text.trim()) {
				yield { type: "error", code: "direct_api_empty_response", message: t("backend.directEmpty") };
				return;
			}
			if (result.usage) {
				yield { type: "usage", usage: result.usage };
				if (this.cancelled.delete(payload.requestId) || controller.signal.aborted) return;
			}
			yield {
				type: "result",
				result: rewrite ? { replacement: result.text } : { text: result.text },
				metadata: {
					provider: this.connection.config.provider,
					model,
					...(payload.effort ? { effort: payload.effort } : {}),
					...(result.usage ? { usage: result.usage } : {}),
				},
			};
		} catch (error) {
			if (this.cancelled.delete(payload.requestId) || controller.signal.aborted || isAbortError(error)) return;
			if (error instanceof ReplyTooLargeError) {
				yield { type: "error", code: "reply_too_large", message: t("backend.replyTooLarge") };
				return;
			}
			if (error instanceof StreamInterruptedError) {
				yield { type: "error", code: "stream_interrupted", message: t("backend.streamInterrupted"), retryable: true };
				return;
			}
			const message = redactCredential(describe(error), this.connection.config.apiKey);
			yield {
				type: "error",
				code: message === unsafeVaultPathMessage() ? "invalid_request" : isAuthError(message) ? "unauthorized" : "direct_api_error",
				message,
			};
		} finally {
			this.cancelled.delete(payload.requestId);
			this.inFlight.delete(payload.requestId);
			yield { type: "done" };
		}
	}

	private async discoverModels(forceRemote = false): Promise<DiscoveredModel[]> {
		const pinned = this.connection.config.modelIds.map((id) => ({ id }));
		if (!forceRemote && pinned.length > 0) return pinned;
		const preset = providerOf(this.connection);
		if (requiresApiKey(preset) && !this.connection.config.apiKey) throw new Error(t("backend.missingApiKey"));
		// A provider whose API lists no models answers from its own catalogue entry — never from another provider's.
		if (preset.modelDiscovery === "preset" && preset.models?.length) return preset.models.map((id) => ({ id }));
		const provider = this.connection.config.provider;
		const base = baseUrl(this.connection);
		const request = modelRequest(provider, base, this.connection.config.apiKey);
		const response = await this.httpClient({ url: request.url, headers: request.headers });
		if (!response.ok) throw await httpError(response, this.connection.config.apiKey);
		const raw = response.json as Record<string, unknown>;
		const list = provider === "google" ? raw.models : raw.data;
		if (!Array.isArray(list)) return [];
		const discovered = list.flatMap((item) => parseListedModel(provider, item));
		return pinned.length > 0 ? pinned : discovered;
	}

	private async complete(
		model: string,
		messages: AdapterMessage[],
		instructions: string | undefined,
		effort: string | null,
		signal: AbortSignal,
	): Promise<Completion> {
		const provider = this.connection.config.provider;
		const key = this.connection.config.apiKey;
		const base = baseUrl(this.connection);
		const request = completionRequest(provider, base, key, model, messages, instructions, effort);
		const response = await this.httpClient({
			url: request.url,
			method: "POST",
			signal,
			headers: request.headers,
			body: JSON.stringify(request.body),
		});
		if (!response.ok) throw await httpError(response, key);
		if (response.text.length > MAX_REPLY_CHARS) throw new ReplyTooLargeError();
		return parseCompletion(provider, object(response.json));
	}

	/**
	 * The same request with streaming asked for, its text handed out as it
	 * arrives and the completion returned at the end. A server that answers
	 * with plain JSON instead is read as one whole reply.
	 */
	private async *streamCompletion(
		streamClient: StreamClient,
		model: string,
		messages: AdapterMessage[],
		instructions: string | undefined,
		effort: string | null,
		signal: AbortSignal,
	): AsyncGenerator<string, Completion> {
		const provider = this.connection.config.provider;
		const key = this.connection.config.apiKey;
		const request = streamingRequest(provider, completionRequest(provider, baseUrl(this.connection), key, model, messages, instructions, effort));
		const response = await streamClient({ url: request.url, method: "POST", signal, headers: request.headers, body: JSON.stringify(request.body) });
		if (!response.ok) throw await httpError({ status: response.status, text: await response.text() }, key);
		if (!isEventStream(response.headers)) {
			let json: unknown = null;
			try { json = JSON.parse(await response.text()); } catch { /* an empty reply is reported below */ }
			return parseCompletion(provider, object(json));
		}
		if (!response.body) throw new StreamUnavailableError("the response carried no readable body");
		let text = "";
		let finishReason: string | undefined;
		let usage: UsageInfo | undefined;
		for await (const data of sseData(response.body)) {
			if (data === "[DONE]") break;
			let raw: unknown;
			try { raw = JSON.parse(data); } catch { continue; }
			const chunk = streamChunk(provider, object(raw));
			if (chunk.error) throw new Error(chunk.error);
			if (chunk.text) {
				text += chunk.text;
				if (text.length > MAX_REPLY_CHARS) throw new ReplyTooLargeError();
				yield chunk.text;
			}
			if (chunk.finishReason) finishReason = chunk.finishReason;
			if (chunk.usage) usage = { ...usage, ...chunk.usage };
		}
		return completion(text, finishReason, usage);
	}
}

/** The completion request, asked to stream: a flag for OpenAI-style and Anthropic bodies, a different method for Google. */
function streamingRequest(
	provider: DirectAPIProvider,
	request: { url: string; headers: Record<string, string>; body: unknown },
): { url: string; headers: Record<string, string>; body: unknown } {
	const body = object(request.body);
	if (provider === "google") return { ...request, url: request.url.replace(":generateContent", ":streamGenerateContent?alt=sse") };
	if (provider === "anthropic") {
		// Anthropic answers browser-originated requests only when told they are intentional.
		return { ...request, headers: { ...request.headers, "anthropic-dangerous-direct-browser-access": "true" }, body: { ...body, stream: true } };
	}
	// `stream_options` is OpenAI's; a compatible server may reject an unknown field, so only OpenAI is asked for usage.
	return { ...request, body: { ...body, stream: true, ...(provider === "openai" ? { stream_options: { include_usage: true } } : {}) } };
}

interface StreamChunk { text?: string; finishReason?: string; usage?: UsageInfo; error?: string }

/** One streamed event, read in the provider's own shape. */
function streamChunk(provider: DirectAPIProvider, raw: Record<string, unknown>): StreamChunk {
	if (provider === "anthropic") {
		const type = string(raw.type);
		if (type === "content_block_delta") {
			const delta = object(raw.delta);
			return delta.type === "text_delta" && typeof delta.text === "string" ? { text: delta.text } : {};
		}
		if (type === "message_start") return { usage: parseUsage(object(raw.message).usage, "input_tokens", "output_tokens") };
		if (type === "message_delta") return { finishReason: string(object(raw.delta).stop_reason), usage: parseUsage(raw.usage, "input_tokens", "output_tokens") };
		if (type === "error") return { error: string(object(raw.error).message) ?? "stream error" };
		return {};
	}
	if (provider === "google") {
		const candidates = Array.isArray(raw.candidates) ? raw.candidates : [];
		const first = object(candidates[0]);
		const parts = Array.isArray(object(first.content).parts) ? (object(first.content).parts as unknown[]) : [];
		return {
			text: parts.flatMap(googleTextParts).join(""),
			finishReason: string(first.finishReason),
			usage: parseUsage(raw.usageMetadata, "promptTokenCount", "candidatesTokenCount", "totalTokenCount"),
		};
	}
	// An OpenAI-style server that fails mid-stream sends `{"error": {...}}` in
	// place of a chunk; the text before it is not an answer.
	if (raw.error !== undefined) {
		const detail = object(raw.error);
		return { error: string(detail.message) ?? (typeof raw.error === "string" ? raw.error : "stream error") };
	}
	const choices = Array.isArray(raw.choices) ? raw.choices : [];
	const first = object(choices[0]);
	const content = object(first.delta).content;
	return {
		...(typeof content === "string" ? { text: content } : {}),
		finishReason: string(first.finish_reason),
		usage: parseUsage(raw.usage, "prompt_tokens", "completion_tokens", "total_tokens"),
	};
}

function baseUrl(connection: DirectAPIConnection): string {
	const configured = connection.config.baseUrl.trim().replace(/\/+$/, "");
	if (configured) return configured;
	switch (connection.config.provider) {
		case "openai": return "https://api.openai.com/v1";
		case "anthropic": return "https://api.anthropic.com/v1";
		case "google": return "https://generativelanguage.googleapis.com/v1beta";
		case "openai-compatible": return "";
	}
}

function modelRequest(provider: DirectAPIProvider, base: string, key: string): { url: string; headers: Record<string, string> } {
	if (provider === "google") return { url: base + "/models", headers: { "x-goog-api-key": key } };
	if (provider === "anthropic") return { url: base + "/models", headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } };
	return { url: base + "/models", headers: bearer(key) };
}

/** An unauthenticated OpenAI-compatible server gets no Authorization header rather than an empty one. */
function bearer(key: string): Record<string, string> {
	return key ? { Authorization: "Bearer " + key } : {};
}

function completionRequest(
	provider: DirectAPIProvider,
	base: string,
	key: string,
	model: string,
	messages: AdapterMessage[],
	instructions: string | undefined,
	effort: string | null,
): { url: string; headers: Record<string, string>; body: unknown } {
	if (provider === "anthropic") {
		return {
			url: base + "/messages",
			headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
			body: { model, max_tokens: 4096, ...(instructions ? { system: instructions } : {}), messages },
		};
	}
	if (provider === "google") {
		return {
			url: base + "/models/" + encodeURIComponent(model) + ":generateContent",
			headers: { "Content-Type": "application/json", "x-goog-api-key": key },
			body: {
				...(instructions ? { systemInstruction: { parts: [{ text: instructions }] } } : {}),
				contents: messages.map((message) => ({
					role: message.role === "assistant" ? "model" : "user",
					parts: [{ text: message.content }],
				})),
			},
		};
	}
	return {
		url: base + "/chat/completions",
		headers: { "Content-Type": "application/json", ...bearer(key) },
		body: {
			model,
			messages: withSystemMessage(instructions, messages),
			stream: false,
			...(effort ? { reasoning_effort: effort } : {}),
		},
	};
}

function parseCompletion(provider: DirectAPIProvider, raw: Record<string, unknown>): Completion {
	if (provider === "anthropic") {
		const content = Array.isArray(raw.content) ? raw.content : [];
		const text = content.flatMap(anthropicTextParts).join("");
		return completion(text, string(raw.stop_reason), parseUsage(raw.usage, "input_tokens", "output_tokens"));
	}
	if (provider === "google") {
		const candidates = Array.isArray(raw.candidates) ? raw.candidates : [];
		const first = object(candidates[0]);
		const content = object(first.content);
		const parts = Array.isArray(content.parts) ? content.parts : [];
		return completion(
			parts.flatMap(googleTextParts).join(""),
			string(first.finishReason),
			parseUsage(raw.usageMetadata, "promptTokenCount", "candidatesTokenCount", "totalTokenCount"),
		);
	}
	const choices = Array.isArray(raw.choices) ? raw.choices : [];
	const first = object(choices[0]);
	const message = object(first.message);
	return completion(
		typeof message.content === "string" ? message.content : "",
		string(first.finish_reason),
		parseUsage(raw.usage, "prompt_tokens", "completion_tokens", "total_tokens"),
	);
}

function anthropicTextParts(value: unknown): string[] {
	const record = object(value);
	return record.type === "text" && typeof record.text === "string" ? [record.text] : [];
}
function googleTextParts(value: unknown): string[] {
	const record = object(value);
	return record.thought !== true && typeof record.text === "string" ? [record.text] : [];
}
function parseUsage(raw: unknown, inputKey: string, outputKey: string, totalKey?: string): UsageInfo | undefined {
	const value = object(raw);
	const input = number(value[inputKey]);
	const output = number(value[outputKey]);
	const total = totalKey ? number(value[totalKey]) : undefined;
	return input === undefined && output === undefined && total === undefined ? undefined : {
		...(input !== undefined ? { inputTokens: input } : {}),
		...(output !== undefined ? { outputTokens: output } : {}),
		...(total !== undefined ? { totalTokens: total } : {}),
	};
}
function completion(text: string, finishReason: string | undefined, usage: UsageInfo | undefined): Completion {
	return { text, ...(finishReason ? { finishReason } : {}), ...(usage ? { usage } : {}) };
}
function object(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}; }
function string(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function number(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function isOutputBudgetExhausted(reason: string | undefined): boolean {
	const normalized = reason?.trim().toLowerCase().replace(/[\s-]+/g, "_");
	return normalized === "length" || normalized === "max_tokens";
}
function capitalize(value: string): string { return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value; }

/**
 * One listed model, with whatever it said about reasoning effort.
 *
 * The OpenAI listing format carries no capability fields, so most entries
 * come back with `efforts` undefined and the family rule below decides. An
 * endpoint that does describe its models is believed instead: a ladder under
 * any of the field names in use (`efforts`, `effort_levels`, `effortLevels`,
 * `reasoning_efforts`, `supported_reasoning_levels[].effort`, or the same
 * inside a `capabilities` object) becomes the ladder offered, and an explicit
 * `supports_reasoning_effort: false` (or an empty ladder) means none.
 */
export function parseListedModel(provider: DirectAPIProvider, item: unknown): DiscoveredModel[] {
	if (typeof item === "string") return [{ id: item }];
	if (typeof item !== "object" || item === null) return [];
	const record = item as Record<string, unknown>;
	const rawId = record.id ?? record.name;
	if (typeof rawId !== "string") return [];
	const id = provider === "google" ? rawId.replace(/^models\//, "") : rawId;
	const efforts = advertisedEfforts(record) ?? advertisedEfforts(object(record.capabilities));
	return [efforts === undefined ? { id } : { id, efforts }];
}

function advertisedEfforts(record: Record<string, unknown>): string[] | undefined {
	const flag = record.supports_reasoning_effort ?? record.supportsReasoningEffort ?? record.reasoning_effort;
	if (flag === false) return [];
	for (const key of ["efforts", "effort_levels", "effortLevels", "reasoning_efforts", "reasoningEfforts", "supported_reasoning_efforts", "supported_reasoning_levels"]) {
		const value = record[key];
		if (!Array.isArray(value)) continue;
		return value.flatMap((entry) => {
			if (typeof entry === "string") return [entry];
			const effort = object(entry).effort ?? object(entry).id;
			return typeof effort === "string" ? [effort] : [];
		});
	}
	return flag === true ? DEFAULT_EFFORT_LADDER : undefined;
}

const DEFAULT_EFFORT_LADDER = ["minimal", "low", "medium", "high"];

/**
 * Whether a model takes `reasoning_effort`, and which values.
 *
 * What the endpoint advertised wins. Without that, a model of a reasoning
 * family (GPT-5, o1, o3, o4 — also behind a vendor prefix such as
 * `openai/gpt-5`) gets the standard ladder on OpenAI and on any
 * OpenAI-compatible endpoint, since a gateway or router that fronts those
 * models passes the field through. Everything else is offered no effort:
 * a compatible endpoint is not assumed to understand the field just because
 * it speaks the protocol. Anthropic and Google use other mechanisms.
 */
export function directEfforts(provider: DirectAPIProvider, model: string, advertised?: string[]): Array<{ id: string; label: string }> {
	if (advertised !== undefined) return advertised.map((id) => ({ id, label: capitalize(id) }));
	if (provider !== "openai" && provider !== "openai-compatible") return [];
	if (!isReasoningFamily(model)) return [];
	return DEFAULT_EFFORT_LADDER.map((id) => ({ id, label: capitalize(id) }));
}

function isReasoningFamily(model: string): boolean {
	const bare = model.slice(model.lastIndexOf("/") + 1);
	return /^(gpt-5|o[134])(?![a-z])/i.test(bare);
}
function uniqueEfforts(values: Array<{ id: string; label: string }>): Array<{ id: string; label: string }> {
	return [...new Map(values.map((value) => [value.id, value])).values()];
}
function describe(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function isAbortError(error: unknown): boolean { return error instanceof Error && error.name === "AbortError"; }
function isAuthError(error: unknown): boolean { const value = describe(error); return value.includes("HTTP 401") || value.includes("HTTP 403") || value.includes("Authentication Error"); }
async function httpError(response: { status: number; text: string }, credential: string): Promise<Error> { const safe = redactCredential(response.text.slice(0, 200), credential); return new Error("HTTP " + response.status + (safe ? "：" + safe : "")); }
