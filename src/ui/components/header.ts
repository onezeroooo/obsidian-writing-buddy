/** Product identity and aggregate AI Connection health. */
import { setTooltip } from "obsidian";
import { t } from "../../i18n";
import type { ConnectionRecord } from "../../connections/types";
import { connectionProviderLabel } from "../../connections/types";
import { ICONS, iconSpan } from "../icons";

export interface HeaderOptions {
	localReady: boolean;
	localError: string | null;
	connections: ConnectionRecord[];
	busy: boolean;
}

export interface AggregateConnectionStatus {
	state: "loading" | "working" | "all" | "partial" | "none" | "empty" | "unknown" | "local-error";
	label: string;
	detail: string;
}

export function aggregateConnectionStatus(options: HeaderOptions): AggregateConnectionStatus {
	if (options.localError) return { state: "local-error", label: t("header.localError"), detail: options.localError };
	if (!options.localReady) return { state: "loading", label: t("header.loading"), detail: t("header.loadingDetail") };
	if (options.busy) return { state: "working", label: t("header.working"), detail: t("header.workingDetail") };
	const enabled = options.connections.filter((record) => record.connection.enabled);
	if (enabled.length === 0) return { state: "empty", label: t("header.aiUnconfigured"), detail: t("header.aiUnconfiguredDetail") };
	if (enabled.some((record) => record.health.kind === "checking")) {
		return { state: "loading", label: t("header.aiChecking"), detail: t("header.aiCheckingDetail") };
	}
	const connected = enabled.filter((record) => record.health.kind === "connected").length;
	const unknown = enabled.filter((record) => record.health.kind === "unknown").length;
	if (connected === enabled.length) return { state: "all", label: t("header.aiConnected"), detail: t("header.aiConnectedDetail", { count: connected }) };
	if (unknown === enabled.length) return { state: "unknown", label: t("header.aiUnchecked"), detail: t("header.aiUncheckedAllDetail", { count: enabled.length }) };
	if (connected > 0) return { state: "partial", label: t("header.aiPartial"), detail: t("header.aiPartialDetail", { connected, total: enabled.length }) };
	if (unknown > 0) return { state: "unknown", label: t("header.aiUnchecked"), detail: t("header.aiUncheckedSomeDetail", { unknown, total: enabled.length }) };
	return { state: "none", label: t("header.aiUnavailable"), detail: t("header.aiUnavailableDetail", { count: enabled.length }) };
}

export function renderHeader(parent: HTMLElement, options: HeaderOptions): void {
	dismissConnectionPopovers(parent.ownerDocument);
	const header = parent.createDiv({ cls: "wb-header" });
	const identity = header.createDiv({ cls: "wb-identity" });
	iconSpan(identity, ICONS.brand, "wb-brand-icon");
	const titles = identity.createDiv({ cls: "wb-identity-text" });
	titles.createDiv({ cls: "wb-brand", text: t("settings.pluginName") });
	titles.createDiv({ cls: "wb-subtitle", text: "Obsidian WritingBuddy" });

	const resolved = aggregateConnectionStatus(options);
	const status = header.createEl("button", {
		cls: "wb-status",
		attr: { type: "button", "aria-label": resolved.detail, "aria-expanded": "false" },
	});
	status.addClass("is-" + resolved.state);
	status.createSpan({ cls: "wb-status-dot", attr: { "aria-hidden": "true" } });
	status.createSpan({ cls: "wb-status-label", text: resolved.label });
	setTooltip(status, resolved.detail, { placement: "bottom" });
	status.addEventListener("click", () => toggleConnectionPopover(status, options.connections));
}

export function dismissConnectionPopovers(document: Document): void {
	document.querySelectorAll<HTMLElement>(".wb-connection-popover").forEach((element) => {
		(element as HTMLElement & { wbCleanup?: () => void }).wbCleanup?.();
		element.remove();
	});
}

function toggleConnectionPopover(anchor: HTMLButtonElement, records: ConnectionRecord[]): void {
	const document = anchor.ownerDocument;
	const existing = document.querySelector<HTMLElement>(".wb-connection-popover");
	if (existing) {
		const cleanup = (existing as HTMLElement & { wbCleanup?: () => void }).wbCleanup;
		cleanup?.();
		existing.remove();
		anchor.setAttribute("aria-expanded", "false");
		return;
	}
	const popover = document.body.createDiv({ cls: "wb-connection-popover" });
	positionConnectionPopover(anchor, popover);
	const close = (event: PointerEvent): void => {
		const target = event.target instanceof Node ? event.target : null;
		if (target && (popover.contains(target) || anchor.contains(target))) return;
		popover.remove();
		anchor.setAttribute("aria-expanded", "false");
		document.removeEventListener("pointerdown", close, true);
		window.removeEventListener("resize", reposition);
		document.removeEventListener("scroll", reposition, true);
		document.removeEventListener("keydown", closeOnEscape, true);
	};
	const reposition = (): void => positionConnectionPopover(anchor, popover);
	const closeOnEscape = (event: KeyboardEvent): void => {
		if (event.key !== "Escape") return;
		(popover as HTMLElement & { wbCleanup?: () => void }).wbCleanup?.();
		popover.remove();
		anchor.setAttribute("aria-expanded", "false");
		anchor.focus();
	};
	(popover as HTMLElement & { wbCleanup?: () => void }).wbCleanup = () => {
		document.removeEventListener("pointerdown", close, true);
		window.removeEventListener("resize", reposition);
		document.removeEventListener("scroll", reposition, true);
		document.removeEventListener("keydown", closeOnEscape, true);
	};
	document.addEventListener("pointerdown", close, true);
	window.addEventListener("resize", reposition);
	document.addEventListener("scroll", reposition, true);
	document.addEventListener("keydown", closeOnEscape, true);
	anchor.setAttribute("aria-expanded", "true");
	if (records.length === 0) {
		popover.createDiv({ cls: "wb-connection-popover-empty", text: t("header.popoverEmpty") });
		return;
	}
	for (const record of records) {
		const row = popover.createDiv({ cls: "wb-connection-popover-row" });
		row.createSpan({ cls: "wb-connection-health-dot is-" + record.health.kind, attr: { "aria-hidden": "true" } });
		const text = row.createDiv({ cls: "wb-connection-popover-text" });
		text.createDiv({ cls: "wb-connection-popover-name", text: record.connection.name });
		text.createDiv({ cls: "wb-connection-popover-detail", text: connectionProviderLabel(record.connection) + " · " + healthLabel(record.health.kind) });
		if (record.health.detail) row.title = record.health.detail;
	}
	positionConnectionPopover(anchor, popover);
}

function positionConnectionPopover(anchor: HTMLElement, popover: HTMLElement): void {
	const rect = anchor.getBoundingClientRect();
	const width = Math.min(280, Math.max(210, window.innerWidth - 24));
	const estimatedHeight = Math.min(popover.scrollHeight || 240, window.innerHeight - 24);
	const below = rect.bottom + 7;
	const top = below + estimatedHeight <= window.innerHeight - 12
		? below
		: Math.max(12, rect.top - estimatedHeight - 7);
	popover.style.width = width + "px";
	popover.style.left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width)) + "px";
	popover.style.top = top + "px";
}

export function healthLabel(kind: ConnectionRecord["health"]["kind"]): string {
	switch (kind) {
		case "connected": return t("health.connected");
		case "checking": return t("health.checking");
		case "offline": return t("health.offline");
		case "auth-error": return t("health.authError");
		case "unavailable": return t("health.unavailable");
		case "disabled": return t("health.disabled");
		case "unknown": return t("health.unknown");
	}
}
