/**
 * Run async work over a list, a few items at a time.
 *
 * The storage layer's reads were written as a plain `for … await` loop, which is
 * correct but issues one round-trip at a time. Against `node:fs` that costs
 * almost nothing; against Obsidian's `DataAdapter` — which is what actually runs
 * in the app — the wall-clock cost of loading a hundred conversations is a
 * hundred sequential latencies, and it grows linearly with a writer's history.
 *
 * The limit is deliberate rather than unbounded: firing several hundred reads at
 * the vault at once competes with Obsidian's own indexing during startup, which
 * is the moment this runs. A small window gets nearly all of the benefit without
 * that.
 *
 * Results come back in input order, so nothing downstream has to care that the
 * work was reordered.
 */

/** How many vault reads are in flight at once. */
export const DEFAULT_CONCURRENCY = 8;

export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	run: (item: T, index: number) => Promise<R>,
	limit = DEFAULT_CONCURRENCY,
): Promise<R[]> {
	if (items.length === 0) return [];

	const results = new Array<R>(items.length);
	const width = Math.max(1, Math.min(limit, items.length));
	let next = 0;

	const worker = async (): Promise<void> => {
		for (;;) {
			const index = next;
			next += 1;
			if (index >= items.length) return;
			results[index] = await run(items[index], index);
		}
	};

	await Promise.all(Array.from({ length: width }, worker));
	return results;
}
