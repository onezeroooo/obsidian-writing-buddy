import { App, Modal, Setting } from "obsidian";
import { t } from "../i18n";
import { ConfirmModal } from "./modals";
import type WritingBuddyPlugin from "../main";
import type { AIConnection } from "../connections/types";
import { acceptsApiKey, newConnectionFor, providerOf, requiresApiKey, searchProviders, type ProviderDefinition } from "../connections/providers";
import { createConnectionId } from "../util/id";
import { healthLabel } from "./components/header";

/**
 * Add or edit an AI connection.
 *
 * Adding starts from the provider catalogue: the writer picks a name they
 * recognise, and the form then asks only for what that provider needs. Which
 * adapter carries the traffic is never shown.
 */
export class ConnectionModal extends Modal {
	private draft: AIConnection | null;
	private readonly creating: boolean;
	private status = "";
	private busyAction: "test" | "save" | null = null;
	private saved = false;
	private query = "";
	/** Model ids the last test discovered for the draft, keyed by connection id. */
	private discovered: string[] | null = null;

	constructor(
		app: App,
		private readonly plugin: WritingBuddyPlugin,
		connection?: AIConnection,
		private readonly onSaved: () => void = () => undefined,
	) {
		super(app);
		this.creating = connection === undefined;
		this.draft = connection ? structuredClone(connection) : null;
	}

	onOpen(): void {
		this.modalEl.addClass("wb-connection-modal-shell");
		this.render();
	}
	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("wb-connection-modal");
		if (!this.draft) { this.renderPicker(contentEl); return; }
		const draft = this.draft;
		const provider = providerOf(draft);
		contentEl.createEl("h2", { text: this.creating ? t("settings.connections.add") : draft.name });
		if (this.creating) {
			new Setting(contentEl).setName(t("connModal.fieldProvider")).setDesc(provider.name)
				.addExtraButton((button) => button.setIcon("arrow-left").setTooltip(t("connModal.changeProvider")).onClick(() => { this.draft = null; this.discovered = null; this.render(); }));
		}

		new Setting(contentEl).setName(t("connModal.fieldName")).addText((text) => text.setValue(draft.name).onChange((value) => { draft.name = value; }));
		const live = this.plugin.connectionRecords().find((record) => record.connection.id === draft.id);
		if (live) {
			new Setting(contentEl).setName(t("connModal.fieldStatus")).setDesc(healthLabel(live.health.kind) + (live.health.detail ? " · " + live.health.detail : ""));
			if (live.health.lastChecked) new Setting(contentEl).setName(t("connModal.lastChecked")).setDesc(new Date(live.health.lastChecked).toLocaleString());
		}

		this.renderProviderFields(contentEl, draft, provider);

		contentEl.createDiv({ cls: "wb-settings-status wb-connection-modal-status", text: this.status, attr: { role: "status" } });

		const actions = new Setting(contentEl).setClass("wb-connection-modal-actions");
		if (!this.creating) {
			actions.addButton((button) => button.setButtonText(t("connModal.delete")).setWarning().setDisabled(this.busyAction !== null).onClick(() => void this.remove()));
		}
		actions
			.addButton((button) => button.setButtonText(this.busyAction === "test" ? t("settings.connections.testing") : t("settings.connections.test")).setDisabled(this.busyAction !== null).onClick(() => void this.test()))
			.addButton((button) => button.setButtonText(this.busyAction === "save" ? t("common.saving") : t("connModal.save")).setCta().setDisabled(this.busyAction !== null).onClick(() => void this.save()));
	}

	/**
	 * Step one of adding: pick a provider.
	 *
	 * One search box with a dropdown: focusing it lists every provider,
	 * typing narrows the list, the arrow keys move the highlight, Enter or a
	 * click chooses. The list floats under the box rather than growing the
	 * dialog.
	 */
	private renderPicker(parent: HTMLElement): void {
		parent.createEl("h2", { text: t("settings.connections.add") });
		const field = parent.createDiv({ cls: "wb-provider-field" });
		const search = field.createEl("input", { type: "search", cls: "wb-provider-search", attr: { placeholder: t("connModal.searchProviders"), "aria-label": t("connModal.searchProviders"), role: "combobox", "aria-expanded": "false", "aria-autocomplete": "list" } });
		search.value = this.query;
		const list = field.createDiv({ cls: "wb-provider-list", attr: { role: "listbox" } });
		const choose = (provider: ProviderDefinition) => { this.draft = newConnectionFor(provider, createConnectionId()); this.discovered = null; this.status = ""; this.render(); };
		let matches: ProviderDefinition[] = [];
		let active = 0;
		const paint = () => {
			list.querySelectorAll(".wb-provider-row").forEach((row, index) => {
				row.toggleClass("is-active", index === active);
				row.setAttribute("aria-selected", String(index === active));
			});
			list.querySelector(".wb-provider-row.is-active")?.scrollIntoView({ block: "nearest" });
		};
		let open = false;
		const draw = () => {
			list.empty();
			matches = searchProviders(this.query.trim());
			active = 0;
			list.toggleClass("is-empty", !open);
			search.setAttribute("aria-expanded", String(open));
			if (!open) return;
			if (matches.length === 0) { list.createDiv({ cls: "wb-provider-empty", text: t("connModal.noProviderMatch") }); return; }
			matches.forEach((provider, index) => {
				const row = list.createDiv({ cls: "wb-provider-row", text: provider.name, attr: { role: "option" } });
				// mousedown, not click: a click would first blur the box and close the list.
				row.addEventListener("mousedown", (event) => { event.preventDefault(); choose(provider); });
				row.addEventListener("mousemove", () => { if (active !== index) { active = index; paint(); } });
			});
			paint();
		};
		search.addEventListener("input", () => { this.query = search.value; open = true; draw(); });
		search.addEventListener("focus", () => { open = true; draw(); });
		search.addEventListener("blur", () => { open = false; draw(); });
		search.addEventListener("keydown", (event) => {
			if (event.key === "Escape" && open) { event.preventDefault(); open = false; draw(); return; }
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				if (matches.length === 0) return;
				event.preventDefault();
				active = (active + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length;
				paint();
			} else if (event.key === "Enter") {
				const provider = matches[active];
				if (provider) { event.preventDefault(); choose(provider); }
			}
		});
		draw();
		window.setTimeout(() => search.focus(), 0);
	}

	/** Only what this provider needs: a key where it takes one, a URL where it is the writer's to choose, then the model. */
	private renderProviderFields(parent: HTMLElement, draft: AIConnection, provider: ProviderDefinition): void {
		if (provider.baseUrlEditable) {
			const isOllama = provider.adapter === "ollama";
			new Setting(parent).setName(isOllama ? "URL" : "Base URL").setDesc(isOllama ? t("connModal.ollamaDesc") : t("connModal.baseUrlDesc")).addText((text) =>
				text.setPlaceholder(provider.defaultBaseUrl || t("connModal.baseUrlPlaceholder")).setValue(draft.config.baseUrl).onChange((value) => { draft.config.baseUrl = value.trim(); }),
			);
		}
		if (acceptsApiKey(provider) && draft.type === "direct-api") {
			const optional = !requiresApiKey(provider);
			new Setting(parent).setName(t("connModal.fieldApiKey")).setDesc(optional ? t("connModal.apiKeyOptionalDesc") : t("connModal.apiKeyDesc")).addText((text) => {
				text.inputEl.type = "password";
				text.inputEl.autocomplete = "off";
				return text.setValue(draft.config.apiKey).onChange((value) => { draft.config.apiKey = value.trim(); });
			});
		}
		if (draft.type === "direct-api") {
			const known = this.discovered ?? (provider.modelDiscovery === "preset" ? provider.models ?? [] : []);
			const pinned = draft.config.modelIds[0] ?? "";
			const options: Record<string, string> = { "": t("connModal.allModels") };
			for (const id of [...new Set([...known, ...draft.config.modelIds])]) options[id] = id;
			new Setting(parent).setName(t("connModal.fieldModel")).setDesc(known.length ? t("connModal.modelDesc") : t("connModal.modelDiscoverHint")).addDropdown((dropdown) =>
				dropdown.addOptions(options).setValue(pinned).onChange((value) => { draft.config.modelIds = value ? [value] : []; }),
			);
		} else if (draft.type === "local" && this.discovered?.length) {
			new Setting(parent).setName(t("connModal.availableModels")).setDesc(this.discovered.join(", "));
		}
	}

	private async test(): Promise<void> {
		if (this.busyAction || !this.draft) return;
		const problem = validateDraft(this.draft);
		if (problem) { this.status = problem; this.render(); return; }
		this.busyAction = "test";
		this.status = t("connModal.testingConnection");
		this.render();
		try {
			const record = await this.plugin.testConnectionDraft(structuredClone(this.draft));
			this.status = record.health.kind === "connected" ? t("connModal.connected") : record.health.detail ?? record.health.kind;
			// The models this connection can actually reach — only this connection's, never another provider's.
			if (record.capabilities) this.discovered = record.capabilities.providers.flatMap((provider) => provider.models.map((model) => model.id));
		} catch (error) {
			this.status = error instanceof Error ? error.message : String(error);
		} finally {
			this.busyAction = null;
			this.render();
		}
	}

	private async save(): Promise<void> {
		if (this.busyAction || this.saved || !this.draft) return;
		const problem = validateDraft(this.draft);
		if (problem) { this.status = problem; this.render(); return; }
		this.busyAction = "save";
		this.status = t("connModal.savingStatus");
		this.render();
		try {
			const saved = structuredClone(this.draft);
			if (this.creating) await this.plugin.addConnection(saved);
			else await this.plugin.updateConnection(saved);
			this.saved = true;
			this.onSaved();
			this.close();
		} catch (error) {
			this.busyAction = null;
			this.status = error instanceof Error ? error.message : String(error);
			this.render();
		}
	}

	private async remove(): Promise<void> {
		if (!this.draft) return;
		const confirmed = await new ConfirmModal(this.app, {
			title: t("connModal.deleteTitle"),
			body: t("connModal.deleteBody"),
			confirmText: t("connModal.delete"),
			destructive: true,
		}).openAndConfirm();
		if (!confirmed) return;
		await this.plugin.removeConnection(this.draft.id);
		this.onSaved();
		this.close();
	}
}

export function validateDraft(connection: AIConnection): string | null {
	if (!connection.name.trim()) return t("connModal.nameRequired");
	const provider = providerOf(connection);
	if (connection.type === "direct-api") {
		if (requiresApiKey(provider) && !connection.config.apiKey) return t("connModal.apiKeyRequired");
		if (provider.baseUrlEditable && !validUrl(connection.config.baseUrl)) return t("connModal.compatBaseUrl");
	}
	if (connection.type === "local") {
		if (!validUrl(connection.config.baseUrl)) return t("connModal.localUrlInvalid");
		if (connection.config.engine === "openai-compatible" && !validLocalOpenAIBaseUrl(connection.config.baseUrl)) return t("connModal.localLoopbackOnly");
	}
	return null;
}

function validUrl(value: string): boolean {
	try { const url = new URL(value.trim()); return url.protocol === "http:" || url.protocol === "https:"; }
	catch { return false; }
}

function validLocalOpenAIBaseUrl(value: string): boolean {
	try {
		const url = new URL(value.trim());
		const path = url.pathname.replace(/\/+$/, "");
		const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
		const loopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
		return loopback && !url.username && !url.password && !url.search && !url.hash && (path === "" || path === "/v1");
	} catch {
		return false;
	}
}
