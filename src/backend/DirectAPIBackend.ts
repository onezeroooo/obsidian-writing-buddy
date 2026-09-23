import type {
	AIBackend,
	AIEvent,
	Capabilities,
	EffortCapability,
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
import {
	advertisedEffortLadder,
	anthropicThinking,
	fullEffortLadder,
	googleThinkingConfig,
	isAnthropicThinkingFamily,
	isGoogleThinkingFamily,
	isOpenAIReasoningFamily,
} from "./effort";
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
 * `defaultEffort` is the level it named as the model's default, if any.
 */
export interface DiscoveredModel {
	id: string;
	efforts?: string[];
	defaultEffort?: string;
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
		const mapped = models.map((model) => {
			const efforts = directEfforts(provider, model.id, model.efforts, model.defaultEffort);
			const defaultEffort = efforts.find((effort) => effort.default)?.id;
			return { id: model.id, efforts, ...(defaultEffort ? { defaultEffort } : {}) };
		});
		const efforts = uniqueEfforts(mapped.flatMap((model) => model.efforts));
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
				const stream = this.streamCompletion(this.streamClient, model, messages, instructions, payload.effort, payload.maxOutputTokens, controller.signal);
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
					result = await this.complete(model, messages, instructions, payload.effort, payload.maxOutputTokens, controller.signal);
					// Only a whole reply that arrived proves the stream, not the endpoint,
					// was refused. A proxy's error page without CORS headers also fails the
					// fetch; blocking on it left a phone on the whole-reply path, whose
					// platform timeout then cut every long call (2026-09-23).
					this.streamingBlocked = true;
				}
			} else {
				result = await this.complete(model, messages, instructions, payload.effort, payload.maxOutputTokens, controller.signal);
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
				...(error instanceof HttpStatusError ? { status: error.status } : {}),
				...(error instanceof HttpStatusError && error.retryAfterSec !== undefined ? { retryAfterSec: error.retryAfterSec } : {}),
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
		const raw = object(response.json);
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
		maxOutputTokens: number | undefined,
		signal: AbortSignal,
	): Promise<Completion> {
		const provider = this.connection.config.provider;
		const key = this.connection.config.apiKey;
		const base = baseUrl(this.connection);
		const request = completionRequest(provider, base, key, model, messages, instructions, effort, maxOutputTokens);
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
		maxOutputTokens: number | undefined,
		signal: AbortSignal,
	): AsyncGenerator<string, Completion> {
		const provider = this.connection.config.provider;
		const key = this.connection.config.apiKey;
		const request = streamingRequest(provider, completionRequest(provider, baseUrl(this.connection), key, model, messages, instructions, effort, maxOutputTokens));
		const response = await streamClient({ url: request.url, method: "POST", signal, headers: request.headers, body: JSON.stringify(request.body) });
		if (!response.ok) throw await httpError({ status: response.status, text: await response.text(), headers: response.headers }, key);
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
			// Server-authored text, bounded like an HTTP error body; the catch redacts the credential.
			if (chunk.error) throw new Error(chunk.error.slice(0, 200));
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
	maxOutputTokens?: number,
): { url: string; headers: Record<string, string>; body: unknown } {
	if (provider === "anthropic") {
		// Effort is a thinking budget here, and `max_tokens` must leave room for
		// the answer above it. Thinking blocks in the reply are not text and are
		// dropped by the parsers; only the answer reaches the writer. A caller's
		// output budget takes the answer's share, above the same thinking.
		const thinking = anthropicThinking(effort);
		const budgeted = maxOutputTokens ? { ...thinking, max_tokens: ("thinking" in thinking ? thinking.thinking.budget_tokens : 0) + maxOutputTokens } : thinking;
		return {
			url: base + "/messages",
			headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
			body: { model, ...budgeted, ...(instructions ? { system: instructions } : {}), messages },
		};
	}
	if (provider === "google") {
		const thinkingConfig = googleThinkingConfig(effort);
		const generationConfig = { ...(thinkingConfig ? { thinkingConfig } : {}), ...(maxOutputTokens ? { maxOutputTokens } : {}) };
		return {
			url: base + "/models/" + encodeURIComponent(model) + ":generateContent",
			headers: { "Content-Type": "application/json", "x-goog-api-key": key },
			body: {
				...(instructions ? { systemInstruction: { parts: [{ text: instructions }] } } : {}),
				contents: messages.map((message) => ({
					role: message.role === "assistant" ? "model" : "user",
					parts: [{ text: message.content }],
				})),
				...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
			},
		};
	}
	// OpenAI's reasoning models refuse `max_tokens` and want `max_completion_tokens`;
	// compatible servers are the other way round often enough that each gets its own.
	const outputLimit = maxOutputTokens ? (provider === "openai" ? { max_completion_tokens: maxOutputTokens } : { max_tokens: maxOutputTokens }) : {};
	return {
		url: base + "/chat/completions",
		headers: { "Content-Type": "application/json", ...bearer(key) },
		body: {
			model,
			messages: withSystemMessage(instructions, messages),
			stream: false,
			...(effort ? { reasoning_effort: effort } : {}),
			...outputLimit,
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
/**
 * One listed model, with whatever it said about reasoning effort.
 *
 * The OpenAI listing format carries no capability fields, so most entries
 * come back with `efforts` undefined and the ladder rule below decides. An
 * endpoint that does describe its models is believed instead: a ladder under
 * OpenAI's own catalogue name (`supported_reasoning_levels[].effort`, with
 * `default_reasoning_level`) or one of the other field names in use
 * (`efforts`, `effort_levels`, `effortLevels`, `reasoning_efforts`, or the same
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
	const capabilities = object(record.capabilities);
	const efforts = advertisedEfforts(record) ?? advertisedEfforts(capabilities);
	if (efforts === undefined) return [{ id }];
	const defaultEffort = advertisedDefaultEffort(record) ?? advertisedDefaultEffort(capabilities);
	return [{ id, efforts, ...(defaultEffort && efforts.includes(defaultEffort) ? { defaultEffort } : {}) }];
}

function advertisedEfforts(record: Record<string, unknown>): string[] | undefined {
	const flag = record.supports_reasoning_effort ?? record.supportsReasoningEffort ?? record.reasoning_effort;
	if (flag === false) return [];
	for (const key of ["supported_reasoning_levels", "efforts", "effort_levels", "effortLevels", "reasoning_efforts", "reasoningEfforts", "supported_reasoning_efforts"]) {
		const value = record[key];
		if (!Array.isArray(value)) continue;
		return value.flatMap((entry) => {
			if (typeof entry === "string") return [entry];
			const effort = object(entry).effort ?? object(entry).id;
			return typeof effort === "string" ? [effort] : [];
		});
	}
	return flag === true ? fullEffortLadder().map((effort) => effort.id) : undefined;
}

function advertisedDefaultEffort(record: Record<string, unknown>): string | undefined {
	for (const key of ["default_reasoning_level", "default_effort", "defaultEffort"]) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0) return value;
	}
	return undefined;
}

/**
 * The effort ladder a model is offered.
 *
 * What the endpoint advertised wins. Without that, the ladder is the same
 * six words everywhere the vendor has a reasoning control: OpenAI's own
 * reasoning families, every model on an OpenAI-compatible endpoint (a
 * gateway fronts models the plugin cannot name, and passes the field
 * through), Claude models with extended thinking and Gemini models with a
 * thinking budget. A model documented not to take the control — GPT-4-era
 * OpenAI models, Claude 3.5 and earlier, Gemini 2.0 and earlier — is
 * offered none, so a request to it never carries a field it would refuse.
 */
export function directEfforts(provider: DirectAPIProvider, model: string, advertised?: string[], advertisedDefault?: string): EffortCapability[] {
	if (advertised !== undefined) return advertisedEffortLadder(advertised, advertisedDefault);
	switch (provider) {
		case "openai": return isOpenAIReasoningFamily(model) ? fullEffortLadder() : [];
		case "openai-compatible": return fullEffortLadder();
		case "anthropic": return isAnthropicThinkingFamily(model) ? fullEffortLadder() : [];
		case "google": return isGoogleThinkingFamily(model) ? fullEffortLadder() : [];
	}
}
function uniqueEfforts(values: EffortCapability[]): EffortCapability[] {
	return [...new Map(values.map((value) => [value.id, { id: value.id }])).values()];
}
function describe(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function isAbortError(error: unknown): boolean { return error instanceof Error && error.name === "AbortError"; }
function isAuthError(error: unknown): boolean { const value = describe(error); return value.includes("HTTP 401") || value.includes("HTTP 403") || value.includes("Authentication Error"); }
/** The endpoint answered, and said no. Carries the status so health can tell an answer from silence. */
class HttpStatusError extends Error {
	constructor(readonly status: number, message: string, readonly retryAfterSec?: number) { super(message); this.name = "HttpStatusError"; }
}

/** `Retry-After` as seconds from now: the header carries either a delay in seconds or an HTTP date. */
export function retryAfterSeconds(headers: Headers | null | undefined): number | undefined {
	const raw = headers?.get("retry-after")?.trim();
	if (!raw) return undefined;
	if (/^\d+$/u.test(raw)) return Number(raw);
	const at = Date.parse(raw);
	return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}
async function httpError(response: { status: number; text: string; headers?: Headers | null }, credential: string): Promise<Error> {
	const safe = redactCredential(response.text.slice(0, 200), credential);
	return new HttpStatusError(response.status, "HTTP " + response.status + (safe ? "：" + safe : ""), retryAfterSeconds(response.headers));
}
