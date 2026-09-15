/**
 * The bounds on a Full-manuscript run's whole-run deadline.
 *
 * They live in their own module because two very different places need them
 * and neither should pull in the other: `DeviceStore` validates the number a
 * writer chose, and `FullCorpusController` enforces it. `DeviceStore` is on the
 * startup path, so importing the controller there just to read three numbers
 * would drag the whole analysis pipeline into load time.
 *
 * Minutes are the unit a writer picks in Settings; milliseconds are the unit
 * the controller counts in. Both are derived from the same values here so the
 * two cannot drift apart.
 */

/**
 * Below this a run cannot finish anything useful, so a smaller number would
 * only produce a guaranteed failure with a confusing cause.
 */
export const MIN_FULL_CORPUS_DEADLINE_MINUTES = 5;

/**
 * Thirty minutes rather than fifteen.
 *
 * Fifteen was chosen against a fast backend. A whole manuscript batched over a
 * remote queue spends far longer than that without anything being wrong, and
 * the run was being failed for taking the time it legitimately needed. The
 * limit is a runaway guard, not a service-level target.
 */
export const DEFAULT_FULL_CORPUS_DEADLINE_MINUTES = 30;

/**
 * The ceiling stays, and stays finite. A Full run holds a foreground turn and
 * spends real tokens; "no limit" would mean a job that can never be known to
 * be stuck.
 */
export const MAX_FULL_CORPUS_DEADLINE_MINUTES = 120;

export const MINUTE_MS = 60_000;

export function deadlineMsFromMinutes(minutes: number): number {
	return minutes * MINUTE_MS;
}

/**
 * How many batches of a Full run may be in flight at once.
 *
 * The run is a fan-out of independent analyses followed by a reduction, so its
 * wall clock was the sum of every batch's latency purely because the batches
 * were awaited one at a time. Overlapping them is the whole difference between
 * "as slow as the manuscript is long" and "as slow as the slowest few calls".
 *
 * The bound is not about a request-rate limiter. The Self-hosted Runtime was
 * asked directly and has no in-flight cap at all: its only gates are per-IP
 * request-*rate* counters — 120/60s at the Runtime and 60/10s at the Cloudflare
 * edge — which a pool of this width comes nowhere near, since each batch
 * occupies a slot for the length of a generation rather than spending a new
 * request. Note those counters are per source IP and not per device token, so
 * several machines behind one address share them.
 *
 * What the bound is actually protecting is the far end's machine and account.
 * The Runtime spawns an independent provider subprocess per request with no
 * queue between them, so the width chosen here is the number of generations
 * that host runs at once; and upstream account limits are not something the
 * Runtime tracks — they surface mid-stream as `provider_quota_exceeded`, which
 * fails the batch and so the run. A local connection is a harder case still:
 * see `LOCAL_CONNECTION_CONCURRENCY`.
 */
export const MIN_FULL_CORPUS_CONCURRENCY = 1;
/**
 * Six is a client-side constant on purpose.
 *
 * `/v2/capabilities` has no concurrency field today, and inventing a read for
 * one that does not exist yet would have to be rewritten the day it is added.
 * If the Runtime ever advertises a suggested width, that is the moment to stop
 * asking a writer to pick a number. Six because that is where the measured
 * Runtime saturates: the leaf phase took 776 s at four and about 500 s at
 * eight, a third faster rather than half (OW-102, 2026-09-05). Above six the
 * setting buys nothing; below it, it leaves time on the table.
 */
export const DEFAULT_FULL_CORPUS_CONCURRENCY = 6;
export const MAX_FULL_CORPUS_CONCURRENCY = 8;

/**
 * A local model serves one request at a time.
 *
 * `LlamaCppBackend` holds a single-flight guard and answers anything that
 * arrives while it is busy with `local_busy` immediately. Against a local
 * connection, concurrency would not be slower — it would fail the run on its
 * second batch. So the writer's number is a ceiling that local ignores.
 */
export const LOCAL_CONNECTION_CONCURRENCY = 1;
