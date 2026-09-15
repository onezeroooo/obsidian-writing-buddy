import { t } from "../i18n";
import type { AIBackend, AIEvent, Capabilities, HealthResult, RewritePayload, TurnPayload } from "../backend/AIBackend";
import { emptyCapabilities } from "../backend/capabilities";
import type { StreamClient } from "../backend/streaming";
import { DirectAPIBackend } from "../backend/DirectAPIBackend";
import { LlamaCppBackend } from "../backend/LlamaCppBackend";
import { OllamaBackend } from "../backend/OllamaBackend";
import type { AIConnection, ConnectionHealth, ConnectionRecord } from "./types";
import type { HttpClient } from "../backend/HttpClient";

export interface BackendRegistryOptions {
	connections: AIConnection[];
	onChange?: () => void;
	fetchImpl?: typeof fetch;
	httpClient?: HttpClient;
	/** Lets direct connections stream replies; without it they arrive whole. */
	streamClient?: StreamClient;
}

/** The only layer that maps a user-visible Connection to a backend adapter. */
export class BackendRegistry {
	private connections: AIConnection[];
	private readonly health = new Map<string, ConnectionHealth>();
	private readonly capabilities = new Map<string, Capabilities>();
	private readonly backends = new Map<string, AIBackend>();
	private readonly onChange: () => void;
	private readonly fetchImpl: typeof fetch | undefined;
	private readonly httpClient: HttpClient | undefined;
	private readonly streamClient: StreamClient | undefined;

	constructor(options: BackendRegistryOptions) {
		this.connections = options.connections;
		this.onChange = options.onChange ?? (() => undefined);
		this.fetchImpl = options.fetchImpl;
		this.httpClient = options.httpClient;
		this.streamClient = options.streamClient;
		for (const connection of this.connections) {
			this.health.set(connection.id, { kind: connection.enabled ? "unknown" : "disabled" });
		}
	}

	all(): ConnectionRecord[] {
		return this.connections.map((connection) => ({
			connection,
			health: this.health.get(connection.id) ?? { kind: connection.enabled ? "unknown" : "disabled" },
			capabilities: this.capabilities.get(connection.id) ?? null,
		}));
	}

	enabled(): AIConnection[] { return this.connections.filter((connection) => connection.enabled); }
	get(id: string | undefined): AIConnection | null { return id ? this.connections.find((item) => item.id === id) ?? null : null; }
	getCapabilities(id: string | undefined): Capabilities { return id ? this.capabilities.get(id) ?? emptyCapabilities() : emptyCapabilities(); }
	getHealth(id: string | undefined): ConnectionHealth { return id ? this.health.get(id) ?? { kind: "unknown" } : { kind: "unknown" }; }

	replace(connections: AIConnection[]): void {
		this.connections = connections;
		const ids = new Set(connections.map((connection) => connection.id));
		for (const id of this.backends.keys()) if (!ids.has(id)) this.backends.delete(id);
		for (const id of this.capabilities.keys()) if (!ids.has(id)) this.capabilities.delete(id);
		for (const id of this.health.keys()) if (!ids.has(id)) this.health.delete(id);
		for (const connection of connections) {
			if (!connection.enabled) this.health.set(connection.id, { kind: "disabled" });
			else if (!this.health.has(connection.id)) this.health.set(connection.id, { kind: "unknown" });
		}
		this.onChange();
	}

	invalidate(id: string): void {
		this.backends.delete(id);
		this.capabilities.delete(id);
		const connection = this.get(id);
		this.health.set(id, { kind: connection?.enabled ? "unknown" : "disabled" });
		this.onChange();
	}

	backendFor(id: string | undefined): AIBackend | null {
		const connection = this.get(id);
		if (!connection || !connection.enabled) return null;
		const existing = this.backends.get(connection.id);
		if (existing) return existing;
		const backend = new ObservedBackend(this.create(connection), {
			onConnected: () => this.setHealth(connection.id, { kind: "connected", lastChecked: new Date().toISOString() }),
			onError: (event) => {
				// A locally rejected request says nothing about endpoint health. Keep
				// the last observed state instead of turning a safe validation failure
				// into a misleading red Connection indicator.
				if (isClientRequestError(event.code)) return;
				this.setHealth(connection.id, healthFromError(event));
			},
		});
		this.backends.set(connection.id, backend);
		return backend;
	}

	async test(id: string): Promise<ConnectionRecord> {
		const connection = this.get(id);
		if (!connection) throw new Error(t("backend.connectionMissing"));
		if (!connection.enabled) {
			this.setHealth(id, { kind: "disabled" });
			return this.record(id);
		}
		this.setHealth(id, { kind: "checking" });
		const backend = this.backendFor(id);
		if (!backend) return this.record(id);
		const health = await backend.health();
		if (!health.ok) {
			this.setHealth(id, healthFromStatus(health));
			return this.record(id);
		}
		try {
			const capabilities = await backend.getCapabilities();
			this.capabilities.set(id, capabilities);
			this.setHealth(id, { kind: "connected", lastChecked: new Date().toISOString() });
		} catch (error) {
			const detail = describe(error);
			this.setHealth(id, {
				kind: /HTTP (401|403)|token_expired|unauthorized|Token 已过期|Token 无效|token expired|token is invalid or revoked/i.test(detail) ? "auth-error" : "unavailable",
				detail,
				lastChecked: new Date().toISOString(),
			});
		}
		return this.record(id);
	}

	async refreshAll(): Promise<void> {
		await Promise.all(this.enabled().map(async (connection) => { await this.test(connection.id); }));
	}

	aggregate(): { connected: number; enabled: number; checking: boolean } {
		const enabled = this.enabled();
		return {
			connected: enabled.filter((connection) => this.getHealth(connection.id).kind === "connected").length,
			enabled: enabled.length,
			checking: enabled.some((connection) => this.getHealth(connection.id).kind === "checking"),
		};
	}

	private record(id: string): ConnectionRecord {
		const connection = this.get(id);
		if (!connection) throw new Error(t("backend.connectionMissing"));
		return { connection, health: this.getHealth(id), capabilities: this.capabilities.get(id) ?? null };
	}

	private create(connection: AIConnection): AIBackend {
		switch (connection.type) {
			case "direct-api":
				return new DirectAPIBackend({ connection, ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}), ...(this.httpClient ? { httpClient: this.httpClient } : {}), ...(this.streamClient ? { streamClient: this.streamClient } : {}) });
			case "local":
				return connection.config.engine === "ollama"
					? new OllamaBackend(connection, this.fetchImpl, this.httpClient)
					: new LlamaCppBackend(connection, this.fetchImpl, this.httpClient);
		}
	}

	private setHealth(id: string, health: ConnectionHealth): void {
		this.health.set(id, health);
		this.onChange();
	}
}

/** Routes the unified domain request by connectionId. */
export class RoutingAIBackend implements AIBackend {
	readonly displayName = "AI Connections";
	private readonly requests = new Map<string, AIBackend>();
	constructor(private readonly registry: BackendRegistry) {}
	async health(): Promise<HealthResult> { const value = this.registry.aggregate(); return { ok: value.connected > 0, status: value.connected + "/" + value.enabled }; }
	async getCapabilities(): Promise<Capabilities> { return emptyCapabilities(); }
	chat(payload: TurnPayload): AsyncIterable<AIEvent> { return this.route(payload, false); }
	rewrite(payload: RewritePayload): AsyncIterable<AIEvent> { return this.route(payload, true); }
	async cancel(requestId: string): Promise<void> { const backend = this.requests.get(requestId); if (backend) await backend.cancel(requestId); this.requests.delete(requestId); }
	private async *route(payload: TurnPayload | RewritePayload, rewrite: boolean): AsyncIterable<AIEvent> {
		const backend = this.registry.backendFor(payload.connectionId);
		if (!backend) {
			yield { type: "error", code: "connection_unavailable", message: payload.connectionId ? t("backend.connectionGone") : t("backend.selectConnectionFirst") };
			yield { type: "done" };
			return;
		}
		const invalid = validateSelection(this.registry.getCapabilities(payload.connectionId), payload);
		if (invalid) {
			yield { type: "error", code: invalid.code, message: invalid.message };
			yield { type: "done" };
			return;
		}
		this.requests.set(payload.requestId, backend);
		try {
			const routed = payload.effort === "auto" ? { ...payload, effort: null } : payload;
			const stream = rewrite ? backend.rewrite(routed as RewritePayload) : backend.chat(routed);
			for await (const event of stream) yield event;
		} finally {
			this.requests.delete(payload.requestId);
		}
	}
}

function validateSelection(capabilities: Capabilities, payload: TurnPayload): { code: string; message: string } | null {
	if (!payload.provider) return { code: "provider_required", message: "发送前请选择 Provider。" };
	if (!payload.model) return { code: "model_required", message: "发送前请选择 Model。" };
	// An empty cache means discovery has not completed. The adapters still
	// validate their own provider contract; never invent capabilities here.
	if (capabilities.providers.length === 0) return null;
	const provider = capabilities.providers.find((item) => item.id === payload.provider);
	if (!provider) return { code: "provider_unavailable", message: "所选 Provider 不属于这个 Connection。" };
	const model = provider.models.find((item) => item.id === payload.model);
	if (!model) return { code: "model_unavailable", message: "所选 Model 不属于这个 Provider。" };
	const efforts = model.efforts ?? provider.efforts;
	if (efforts.length > 0 && !payload.effort) return { code: "effort_required", message: "发送前请选择 Effort。" };
	if (payload.effort && payload.effort !== "auto" && !efforts.some((item) => item.id === payload.effort)) {
		return { code: "effort_unavailable", message: efforts.length === 0 ? "所选 Model 不支持 Effort。" : "所选 Effort 不属于这个 Model。" };
	}
	return null;
}

function healthFromError(event: Extract<AIEvent, { type: "error" }>): ConnectionHealth {
	const auth = event.code === "unauthorized" || event.code === "token_expired";
	return { kind: auth ? "auth-error" : event.code === "rate_limited" ? "unavailable" : "offline", detail: event.message, lastChecked: new Date().toISOString() };
}

function isClientRequestError(code: string | undefined): boolean {
	return code === "invalid_request" || code === "connection_unavailable" ||
		code === "provider_required" || code === "model_required" ||
		code === "effort_required" || code === "provider_unavailable" ||
		code === "model_unavailable" || code === "effort_unavailable" ||
		code === "local_busy" || code === "output_budget_exhausted" ||
		code === "direct_api_empty_response" || code === "local_empty_response" ||
		code === "cancelled";
}
function healthFromStatus(result: HealthResult): ConnectionHealth {
	const kind = result.status === "unauthorized" || result.status === "token_expired"
		? "auth-error"
		: result.status === "rate_limited" || result.status === "v2_unavailable"
			? "unavailable"
			: "offline";
	return { kind, detail: result.detail ?? result.status, lastChecked: new Date().toISOString() };
}
function describe(error: unknown): string { return error instanceof Error ? error.message : String(error); }

class ObservedBackend implements AIBackend {
	readonly displayName: string;
	constructor(private readonly inner: AIBackend, private readonly observer: { onConnected: () => void; onError: (event: Extract<AIEvent, { type: "error" }>) => void }) { this.displayName = inner.displayName; }
	async health(): Promise<HealthResult> { const result = await this.inner.health(); if (result.ok) this.observer.onConnected(); return result; }
	async getCapabilities(): Promise<Capabilities> { const result = await this.inner.getCapabilities(); this.observer.onConnected(); return result; }
	chat(payload: TurnPayload): AsyncIterable<AIEvent> { return this.observe(this.inner.chat(payload)); }
	rewrite(payload: RewritePayload): AsyncIterable<AIEvent> { return this.observe(this.inner.rewrite(payload)); }
	cancel(requestId: string): Promise<void> { return this.inner.cancel(requestId); }
	private async *observe(stream: AsyncIterable<AIEvent>): AsyncIterable<AIEvent> { let failed = false; for await (const event of stream) { if (event.type === "error") { failed = true; this.observer.onError(event); } yield event; } if (!failed) this.observer.onConnected(); }
}
