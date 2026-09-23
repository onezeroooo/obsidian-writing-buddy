/**
 * Whether the extraction model may be asked right now.
 *
 * The lifecycle delivers a chapter chunk by chunk and a book chapter by
 * chapter, and every chunk is one model call. An endpoint that refuses each
 * call at once — a rate limit, a gateway whose model is cooling down, a
 * server that is not there — would otherwise be asked as fast as it can
 * refuse: one 60-second cooldown once drew 499 requests in 47 seconds. So
 * every answer is reported here, the lifecycle asks before each call, and
 * while the model is unavailable nothing is sent; the queue keeps its place
 * and is worked again when the wait is over.
 *
 * The wait is at least the server's own `Retry-After` when it names one, and
 * otherwise a schedule that lengthens with every consecutive refusal and
 * starts over on the first call that went through. A failure that concerns
 * one passage — the model's output could not be used — is not reported here:
 * it says nothing about the next passage.
 */

/** Waits for the first, second, … consecutive refusal; the last one repeats. */
export const UNAVAILABLE_WAITS_MS = [30_000, 60_000, 120_000, 300_000, 600_000] as const;
/** The longest a server may ask us to wait; a mistyped header must not park the queue for a day. */
export const MAX_RETRY_AFTER_MS = 15 * 60_000;

export interface UnavailableAnswer {
	/** The HTTP status when the endpoint answered; absent for a transport failure. */
	status?: number;
	/** The server's own instruction, in seconds. */
	retryAfterSec?: number;
	/** What the endpoint said, already redacted. */
	message: string;
}

export class ExtractionAvailability {
	private until = 0;
	private consecutive = 0;
	private detail: string | null = null;
	private refused = 0;

	constructor(private readonly now: () => number = Date.now) {}

	/** How long until the model may be asked, in milliseconds; 0 when it may be asked now. */
	waitMs(): number {
		return Math.max(0, this.until - this.now());
	}

	/** When the wait ends, as an ISO timestamp; null when nothing is waiting. */
	get pausedUntil(): string | null {
		return this.waitMs() > 0 ? new Date(this.until).toISOString() : null;
	}

	/** What the endpoint answered when it was last unavailable; null while calls may be made. */
	get reason(): string | null {
		return this.waitMs() > 0 ? this.detail : null;
	}

	/** A call went through: the schedule starts over. */
	answered(): void {
		this.until = 0;
		this.consecutive = 0;
		this.detail = null;
	}

	/**
	 * How many refusals there have been, ever. A delivery compares this before
	 * and after: a run that failed while the count moved met the connection's
	 * refusal, not a fault of its own text — even if another call answered in
	 * the meantime and cleared the wait.
	 */
	get refusals(): number {
		return this.refused;
	}

	/** The endpoint could not take the call; nothing is sent until the wait is over. */
	unavailable(answer: UnavailableAnswer): void {
		this.refused += 1;
		const step = UNAVAILABLE_WAITS_MS[Math.min(this.consecutive, UNAVAILABLE_WAITS_MS.length - 1)];
		const asked = answer.retryAfterSec !== undefined && Number.isFinite(answer.retryAfterSec) && answer.retryAfterSec > 0
			? Math.min(answer.retryAfterSec * 1000, MAX_RETRY_AFTER_MS)
			: 0;
		this.consecutive += 1;
		this.until = this.now() + Math.max(asked, step);
		this.detail = answer.message;
	}
}
