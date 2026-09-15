/**
 * Where startup time actually goes.
 *
 * This exists because "the vault takes three seconds to open" is not a fact
 * anyone can act on. Three seconds of *what* — Obsidian getting to layout-ready,
 * reading ninety conversation files, seeding skills, or building the first
 * transcript? Guessing between those and optimising the wrong one is how a
 * codebase acquires caching nobody needed.
 *
 * So each phase is timed in the real app, with the number of vault I/O calls it
 * made recorded alongside. The call count matters as much as the milliseconds:
 * every one of those calls goes through Obsidian's `DataAdapter`, and a phase
 * that is instant against `node:fs` can be slow in the app purely because it
 * issues hundreds of sequential round-trips.
 *
 * Nothing here is persisted and nothing is sent anywhere. It is a few numbers
 * held in memory for the current session.
 */

import { t } from "../i18n";

export interface PhaseTiming {
	label: string;
	ms: number;
	/** Vault I/O calls issued during this phase. */
	ops: number;
}

export class StartupProfile {
	private readonly phases: PhaseTiming[] = [];
	private readonly startedAt: number;
	private lastAt: number;
	private lastOps: number;

	/** `ops` reports the running total of vault I/O calls made so far. */
	constructor(private readonly ops: () => number) {
		this.startedAt = now();
		this.lastAt = this.startedAt;
		this.lastOps = ops();
	}

	/** Time one awaited phase. */
	async measure<T>(label: string, run: () => Promise<T>): Promise<T> {
		const before = now();
		const beforeOps = this.ops();
		try {
			return await run();
		} finally {
			this.record(label, now() - before, this.ops() - beforeOps);
		}
	}

	/**
	 * Record a milestone reached at some point since the last one.
	 *
	 * Used for time the plugin waited rather than spent — most importantly the
	 * gap between `onload` and Obsidian firing `onLayoutReady`, which is time
	 * the app spent on itself and everything else installed.
	 */
	mark(label: string): void {
		this.record(label, now() - this.lastAt, this.ops() - this.lastOps);
	}

	private record(label: string, ms: number, ops: number): void {
		this.phases.push({ label, ms, ops });
		this.lastAt = now();
		this.lastOps = this.ops();
	}

	/** Recorded startup time. It does not grow after startup has finished. */
	get elapsedMs(): number {
		return this.phases.reduce((sum, phase) => sum + phase.ms, 0);
	}

	get timings(): PhaseTiming[] {
		return [...this.phases];
	}

	get totalOps(): number {
		return this.phases.reduce((sum, phase) => sum + phase.ops, 0);
	}

	/** The slowest phase, which is the only one worth arguing about. */
	get worst(): PhaseTiming | null {
		return this.phases.reduce<PhaseTiming | null>(
			(worst, phase) => (worst === null || phase.ms > worst.ms ? phase : worst),
			null,
		);
	}

	/** A plain table, for the console and for the settings panel. */
	report(): string {
		const width = Math.max(20, ...this.phases.map((phase) => phase.label.length));
		const lines = this.phases.map(
			(phase) =>
				`${phase.label.padEnd(width)}  ${phase.ms.toFixed(0).padStart(6)} ms  ${String(phase.ops).padStart(5)} ${t("main.ioUnit")}`,
		);
		lines.push("-".repeat(width + 22));
		lines.push(
			`${t("main.total").padEnd(width)}  ${this.elapsedMs.toFixed(0).padStart(6)} ms  ${String(this.totalOps).padStart(5)} ${t("main.ioUnit")}`,
		);
		return lines.join("\n");
	}
}

function now(): number {
	return typeof performance !== "undefined" ? performance.now() : Date.now();
}
