/**
 * Reads the currently open Obsidian vault for context assembly.
 *
 * The only Obsidian-aware piece of the context system, and deliberately thin —
 * everything that decides *what* to send lives in `src/context/`, which has no
 * Obsidian import and is therefore testable in plain Node.
 *
 * Two details matter:
 *
 *   - `activeFileText` returns the **editor buffer**, not the file on disk, so a
 *     writer's unsaved edits are visible to the model immediately. Waiting for a
 *     save — let alone for a sync to another machine — would show the model
 *     stale prose.
 *   - `read` uses `cachedRead`, which is Obsidian's read path for display. It is
 *     the right choice for bulk retrieval: it does not fight the editor for the
 *     file handle and it benefits from Obsidian's own cache.
 */

import { MarkdownView, TFile, type App } from "obsidian";
import type { VaultReader } from "./context/types";

export class ObsidianVaultReader implements VaultReader {
	constructor(private readonly app: App) {}

	listMarkdownFiles(): string[] {
		return this.app.vault.getMarkdownFiles().map((file) => file.path);
	}

	async read(path: string): Promise<string> {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) throw new Error(`not a file: ${path}`);
		return this.app.vault.cachedRead(file);
	}

	/**
	 * Outgoing links, resolved to real files.
	 *
	 * Uses Obsidian's own resolution so `[[林昭]]` finds `设定/林昭.md` under the
	 * writer's link settings rather than by string guessing.
	 */
	linksFrom(path: string): string[] {
		const resolved = this.app.metadataCache.resolvedLinks[path];
		return resolved ? Object.keys(resolved) : [];
	}

	activeFilePath(): string | null {
		return this.activeMarkdownView()?.file?.path ?? null;
	}

	activeFileText(): string | null {
		const view = this.activeMarkdownView();
		if (!view) return null;
		// The buffer, including edits that have not been written to disk.
		return view.editor.getValue();
	}

	activeFileCursorOffset(): number | null {
		const view = this.activeMarkdownView();
		if (!view) return null;
		return view.editor.posToOffset(view.editor.getCursor("head"));
	}

	private activeMarkdownView(): MarkdownView | null {
		const active = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (active?.file) return active;

		// The writer is normally focused in WritingBuddy when a request starts.
		// Ask Obsidian for the most recent main-area leaf before falling back to
		// enumeration; the first open Markdown leaf is not necessarily the chapter
		// the writer was just editing.
		const recent = this.app.workspace.getMostRecentLeaf(this.app.workspace.rootSplit)?.view;
		if (recent instanceof MarkdownView && recent.file) return recent;

		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file) return view;
		}
		return null;
	}
}
