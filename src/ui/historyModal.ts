/**
 * The conversation navigator.
 *
 * This replaces the old "recovery centre", which listed closed sessions and
 * offered 恢复 and 永久删除. That framed history as a bin things fall into.
 * History here is simply every conversation, arranged as the branch trees they
 * actually form, grouped by when they were last touched, and searchable.
 *
 * Everything in it comes from real conversation files in
 * `WritingBuddy/conversations/`, loaded by `SessionManager` at startup. There
 * are no fixtures, sample rows or placeholder titles anywhere in this file or
 * anything it calls — a row on screen is a file on disk.
 *
 * Two structural rules make it scannable. The tree is a **grid**: a fixed
 * indent per depth and a dedicated chevron column, so every title at the same
 * depth starts at the same x-position whether or not its row has a chevron.
 * And the current conversation is **found for you** — its ancestors are
 * expanded and it is scrolled into view when the modal opens, because hunting
 * for the conversation you are already in is the one thing this list should
 * never make you do.
 *
 * All of the arranging is done by `historyModel.ts`; this file renders it.
 */

import { Modal, type App } from "obsidian";
import { t } from "../i18n";
import { displayTitle } from "../session/titles";
import type { ConversationSession } from "../types";
import {
	HISTORY_PAGE_SIZE,
	type HistoryNode,
	type SearchHit,
	buildForest,
	filterForest,
	groupByRecency,
	latestActivity,
	pageRoots,
	searchSessions,
	treeSize,
} from "./historyModel";
import { ICONS, iconButton, iconSpan } from "./icons";

/** Indentation per level of branch depth. */
const INDENT_STEP_PX = 16;

export interface HistoryModalOptions {
	/**
	 * Read fresh every time the list is drawn.
	 *
	 * Archiving and deleting change the set while the modal is open, so a
	 * snapshot taken once would keep showing a conversation that is gone.
	 */
	sessions: () => ConversationSession[];
	activeSessionId: () => string | null;
	onOpenSession: (sessionId: string) => void;
	/** Hide or restore. Resolves once the change is on disk. */
	onArchive: (session: ConversationSession, archived: boolean) => Promise<boolean>;
	/** Irreversible. Resolves true when the file was actually removed. */
	onDelete: (session: ConversationSession) => Promise<boolean>;
}

export class HistoryModal extends Modal {
	private query = "";
	private shownRoots = HISTORY_PAGE_SIZE;
	private collapsed = new Set<string>();
	/**
	 * Whether archived conversations are listed.
	 *
	 * Off by default — that is what archiving is for — and a toggle rather than
	 * a separate "bin" screen, so an archived conversation stays in the tree it
	 * belongs to instead of being torn out of its branch structure.
	 */
	private showArchived = false;
	private listEl: HTMLElement | null = null;
	private countEl: HTMLElement | null = null;
	/** Set once, so re-rendering does not keep yanking the list around. */
	private revealed = false;

	constructor(
		app: App,
		private readonly options: HistoryModalOptions,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass("wb-history-modal");
		contentEl.empty();

		const header = contentEl.createDiv({ cls: "wb-history-header" });
		header.createEl("h3", { cls: "wb-history-title", text: t("sessionBar.history") });

		// Global tree controls, next to the title. Individual chevrons and these
		// share one collapsed set, so the two can never disagree.
		const controls = header.createDiv({ cls: "wb-history-controls" });
		iconButton(controls, {
			icon: ICONS.expandAll,
			label: t("history.expandAll"),
			onClick: () => {
				this.collapsed.clear();
				this.renderList();
			},
		});
		iconButton(controls, {
			icon: ICONS.collapseAll,
			label: t("history.collapseAll"),
			onClick: () => {
				this.collapseAll();
				this.renderList();
			},
		});

		const archiveToggle = iconButton(controls, {
			icon: this.showArchived ? ICONS.hideArchived : ICONS.showArchived,
			label: this.showArchived ? t("history.hideArchived") : t("history.showArchived"),
			onClick: () => {
				this.showArchived = !this.showArchived;
				// The button's own icon and label change with it, so redraw the
				// header as well as the list.
				this.onOpen();
			},
		});
		archiveToggle.toggleClass("is-on", this.showArchived);

		const searchRow = contentEl.createDiv({ cls: "wb-history-search" });
		iconSpan(searchRow, ICONS.search, "wb-history-search-icon");
		const input = searchRow.createEl("input", {
			cls: "wb-history-search-input",
			attr: { type: "search", placeholder: t("history.searchPlaceholder"), "aria-label": t("history.searchAria") },
		});
		input.addEventListener("input", () => {
			this.query = input.value;
			// A new query starts a fresh window, otherwise a deep scroll from the
			// previous result set carries over and hides the top matches.
			this.shownRoots = HISTORY_PAGE_SIZE;
			this.renderList();
		});

		this.countEl = contentEl.createDiv({ cls: "wb-history-count" });
		this.listEl = contentEl.createDiv({ cls: "wb-history-list" });

		this.renderList();
		window.setTimeout(() => input.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
		this.listEl = null;
	}

	/**
	 * Redraw for a conversation that arrived from another device.
	 *
	 * This list is the only place a conversation the writer is *not* reading is
	 * on screen, so it is the only thing a change to one has to redraw. The
	 * panel behind it shows a single conversation and does not.
	 */
	refresh(): void {
		this.renderList();
	}

	// -----------------------------------------------------------------------

	/** Collapse every node that has children, leaving the roots visible. */
	private collapseAll(): void {
		const walk = (node: HistoryNode): void => {
			if (node.children.length > 0) this.collapsed.add(node.session.id);
			for (const child of node.children) walk(child);
		};
		for (const root of buildForest(this.options.sessions())) walk(root);
	}

	private renderList(): void {
		const list = this.listEl;
		if (!list) return;
		list.empty();

		const all = this.options.sessions();
		// Archived conversations are simply not in the forest unless asked for,
		// which keeps their branches attached to them rather than orphaned.
		const sessions = this.showArchived ? all : all.filter((session) => !session.closed);
		const archivedCount = all.length - all.filter((session) => !session.closed).length;
		const forest = buildForest(sessions);

		let roots = forest;
		let hits: Map<string, SearchHit> | null = null;

		if (this.query.trim().length > 0) {
			// Search runs over every loaded session, not the rendered window,
			// and keeps a match's ancestors so a nested result still shows where
			// it belongs rather than appearing as a flat orphan.
			hits = searchSessions(sessions, this.query);
			roots = filterForest(forest, hits);
		}

		const page = pageRoots(roots, this.shownRoots);

		if (this.countEl) {
			const total = hits ? t("history.matchCount", { count: countTrees(roots) }) : t("history.totalCount", { count: sessions.length });
			const archived =
				archivedCount > 0 && !this.showArchived ? t("history.archivedSuffix", { count: archivedCount }) : "";
			this.countEl.setText(`${total}${archived}`);
		}

		if (page.items.length === 0) {
			list.createDiv({
				cls: "wb-history-empty",
				text: hits ? t("history.noMatches") : t("history.empty"),
			});
			return;
		}

		for (const group of groupByRecency(page.items)) {
			list.createDiv({ cls: "wb-history-group", text: group.label });
			for (const root of group.roots) this.renderNode(list, root, hits);
		}

		if (page.hasMore) {
			const more = list.createEl("button", {
				cls: "wb-history-more",
				text: t("history.loadMore", { count: page.total - page.shown }),
				attr: { type: "button" },
			});
			more.addEventListener("click", () => {
				this.shownRoots += HISTORY_PAGE_SIZE;
				this.renderList();
			});
		}

		this.revealActive();
	}

	private renderNode(parent: HTMLElement, node: HistoryNode, hits: Map<string, SearchHit> | null): void {
		const session = node.session;
		const isActive = session.id === this.options.activeSessionId();
		const row = parent.createDiv({ cls: "wb-history-row" });
		if (isActive) {
			row.addClass("is-active");
			row.dataset.wbActive = "1";
		}
		if (session.closed) row.addClass("is-archived");

		// Indentation is a spacer element rather than padding on the row, so the
		// chevron column and the title column line up at every depth.
		if (node.depth > 0) {
			row.createSpan({
				cls: "wb-history-indent",
				attr: { "aria-hidden": "true", style: `width: ${node.depth * INDENT_STEP_PX}px` },
			});
		}

		const hasChildren = node.children.length > 0;
		const isCollapsed = this.collapsed.has(session.id);

		if (hasChildren) {
			const toggle = row.createEl("button", {
				cls: "wb-history-twisty",
				attr: {
					type: "button",
					"aria-expanded": String(!isCollapsed),
					"aria-label": isCollapsed ? t("history.expandBranch") : t("history.collapseBranch"),
				},
			});
			iconSpan(toggle, isCollapsed ? ICONS.collapsed : ICONS.expanded);
			toggle.addEventListener("click", (event) => {
				event.stopPropagation();
				if (isCollapsed) this.collapsed.delete(session.id);
				else this.collapsed.add(session.id);
				this.renderList();
			});
		} else {
			// The same width as a chevron, so titles never shift sideways
			// depending on whether a conversation happens to have branches.
			row.createSpan({ cls: "wb-history-twisty-spacer", attr: { "aria-hidden": "true" } });
		}

		const open = row.createEl("button", {
			cls: "wb-history-open",
			attr: { type: "button", "aria-label": t("history.openSession", { title: displayTitle(session.title) }) },
		});

		const line = open.createDiv({ cls: "wb-history-line" });
		const name = line.createSpan({ cls: "wb-history-name" });
		renderHighlighted(name, displayTitle(session.title), this.query);
		// A native title, and only the conversation's name: the row already
		// shows its time and counts, and a heavy dark panel repeating them on
		// every hover made the list unusable to move through.
		name.title = displayTitle(session.title);

		line.createSpan({ cls: "wb-history-meta", text: describeSession(session, node) });

		// An excerpt only earns a second line when it is the reason the row is
		// on screen at all.
		const hit = hits?.get(session.id);
		if (hit && hit.field !== "title") {
			const excerpt = open.createDiv({ cls: "wb-history-excerpt" });
			renderHighlighted(excerpt, hit.excerpt, this.query);
		}

		open.addEventListener("click", () => {
			this.options.onOpenSession(session.id);
			this.close();
		});

		this.renderRowActions(row, session);

		if (hasChildren && !isCollapsed) {
			for (const child of node.children) this.renderNode(parent, child, hits);
		}
	}

	/**
	 * Archive, restore, delete.
	 *
	 * Hover-revealed and at the trailing edge, so a list of forty conversations
	 * reads as forty titles rather than a hundred and twenty buttons — and
	 * always focusable, so they are reachable without a mouse.
	 */
	private renderRowActions(row: HTMLElement, session: ConversationSession): void {
		const actions = row.createDiv({ cls: "wb-history-actions" });

		if (session.closed) {
			iconButton(actions, {
				icon: ICONS.unarchive,
				label: t("history.unarchive"),
				cls: "wb-history-action",
				onClick: async (event) => {
					event.stopPropagation();
					// Taking something back out is not a decision that needs
					// confirming; putting it away was.
					if (await this.options.onArchive(session, false)) this.renderList();
				},
			});
		} else {
			iconButton(actions, {
				icon: ICONS.archive,
				label: t("history.archive"),
				cls: "wb-history-action",
				onClick: async (event) => {
					event.stopPropagation();
					if (await this.options.onArchive(session, true)) this.renderList();
				},
			});
		}

		iconButton(actions, {
			icon: ICONS.remove,
			label: t("modals.deletePermanently"),
			cls: "wb-history-action is-destructive",
			onClick: async (event) => {
				event.stopPropagation();
				if (await this.options.onDelete(session)) this.renderList();
			},
		});
	}

	/**
	 * Bring the conversation you are in into view.
	 *
	 * Nodes are expanded by default, so its ancestors are already open unless
	 * something was collapsed by hand — which is a deliberate act and is left
	 * alone. Only the scroll happens, and only once per opening.
	 */
	private revealActive(): void {
		if (this.revealed || !this.listEl) return;
		const active = this.listEl.querySelector<HTMLElement>('[data-wb-active="1"]');
		if (!active) return;
		this.revealed = true;
		window.setTimeout(() => active.scrollIntoView({ block: "center" }), 0);
	}
}

/**
 * Write text with the matched part marked.
 *
 * Case-insensitive and substring-based, matching how search itself works, so
 * what is highlighted is exactly what was matched.
 */
export function renderHighlighted(parent: HTMLElement, text: string, query: string): void {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) {
		parent.appendText(text);
		return;
	}

	let cursor = 0;
	const haystack = text.toLowerCase();
	for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
		if (at > cursor) parent.appendText(text.slice(cursor, at));
		parent.createSpan({ cls: "wb-history-match", text: text.slice(at, at + needle.length) });
		cursor = at + needle.length;
	}
	if (cursor < text.length) parent.appendText(text.slice(cursor));
}

/**
 * The right-hand metadata: message count, branch count, and time.
 *
 * Exported because the exact composition is what the row layout tests assert.
 */
export function describeSession(session: ConversationSession, node: HistoryNode): string {
	const parts = [t("history.messageCount", { count: session.messages.length })];
	if (node.children.length > 0) parts.push(t("history.branchCount", { count: node.children.length }));
	parts.push(formatWhen(session.updatedAt));
	return parts.filter((part) => part.length > 0).join(" · ");
}

function formatWhen(iso: string): string {
	const when = new Date(iso);
	if (Number.isNaN(when.getTime())) return "";
	const now = new Date();
	const sameDay =
		when.getFullYear() === now.getFullYear() &&
		when.getMonth() === now.getMonth() &&
		when.getDate() === now.getDate();
	if (sameDay) {
		return `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
	}
	return `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}-${String(when.getDate()).padStart(2, "0")}`;
}

function countTrees(roots: HistoryNode[]): number {
	return roots.reduce((sum, root) => sum + treeSize(root), 0);
}

/** Kept for callers that want the tree's own latest activity. */
export { latestActivity };
