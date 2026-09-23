/**
 * Adapts Obsidian's vault adapter to the `VaultFs` port.
 *
 * Kept as its own file so the storage layer never imports `obsidian` and stays
 * testable in plain Node. This is the only place that knows the plugin is
 * running inside Obsidian at all.
 *
 * It also counts its calls. Every operation here crosses Obsidian's adapter,
 * which is not the filesystem and is not free, so the number of round-trips a
 * phase makes explains startup cost better than the milliseconds do when the
 * same code is measured against `node:fs`.
 */

import { type DataAdapter, normalizePath } from "obsidian";
import type { VaultFs } from "./storage/paths";

export class ObsidianVaultFs implements VaultFs {
	private calls = 0;

	constructor(private readonly adapter: DataAdapter) {}

	/** Total vault I/O calls made so far. Read by the startup profile. */
	get callCount(): number {
		return this.calls;
	}

	async exists(path: string): Promise<boolean> {
		this.calls += 1;
		return this.adapter.exists(normalizePath(path));
	}

	async read(path: string): Promise<string> {
		this.calls += 1;
		return this.adapter.read(normalizePath(path));
	}

	async write(path: string, data: string): Promise<void> {
		this.calls += 1;
		await this.adapter.write(normalizePath(path), data);
	}

	async readBinary(path: string): Promise<ArrayBuffer> {
		this.calls += 1;
		return this.adapter.readBinary(normalizePath(path));
	}

	async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
		this.calls += 1;
		await this.adapter.writeBinary(normalizePath(path), data);
	}

	async mkdir(path: string): Promise<void> {
		this.calls += 1;
		await this.adapter.mkdir(normalizePath(path));
	}

	async list(path: string): Promise<{ files: string[]; folders: string[] }> {
		this.calls += 1;
		const listed = await this.adapter.list(normalizePath(path));
		return { files: listed.files, folders: listed.folders };
	}

	async remove(path: string): Promise<void> {
		this.calls += 1;
		await this.adapter.remove(normalizePath(path));
	}

	async rename(from: string, to: string): Promise<void> {
		this.calls += 1;
		await this.adapter.rename(normalizePath(from), normalizePath(to));
	}

	async stat(path: string): Promise<{ mtime: number; size: number } | null> {
		this.calls += 1;
		const stat = await this.adapter.stat(normalizePath(path));
		return stat ? { mtime: stat.mtime, size: stat.size } : null;
	}
}
