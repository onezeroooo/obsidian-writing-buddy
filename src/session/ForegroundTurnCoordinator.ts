/**
 * Serializes the one foreground turn that may use the plugin's shared
 * controllers. A lease is an identity, not just a boolean: stale cleanup from
 * an older turn can never release (or cancel) a newer owner's work.
 */
import { asError } from "../util/errors";

export interface ForegroundTurnLease<Owner extends object> {
	readonly owner: Owner;
	readonly token: symbol;
	/** Aborted synchronously when this exact lease is cancelled. */
	readonly signal: AbortSignal;
}

export class ForegroundTurnCancelledError extends Error {
	constructor() {
		super("Foreground turn was cancelled.");
		this.name = "ForegroundTurnCancelledError";
	}
}

interface ActiveTurn<Owner extends object> {
	lease: ForegroundTurnLease<Owner>;
	abortController: AbortController;
	cancellation: Promise<void> | null;
}

export class ForegroundTurnCoordinator<Owner extends object> {
	private active: ActiveTurn<Owner> | null = null;

	get isActive(): boolean {
		return this.active !== null;
	}

	get activeLease(): ForegroundTurnLease<Owner> | null {
		return this.active?.lease ?? null;
	}

	get activeOwner(): Owner | null {
		return this.active?.lease.owner ?? null;
	}

	tryAcquire(owner: Owner): ForegroundTurnLease<Owner> | null {
		if (this.active) return null;
		const abortController = new AbortController();
		const lease: ForegroundTurnLease<Owner> = Object.freeze({
			owner,
			token: Symbol("foreground-turn"),
			signal: abortController.signal,
		});
		this.active = { lease, abortController, cancellation: null };
		return lease;
	}

	isCurrent(lease: ForegroundTurnLease<Owner>): boolean {
		return this.active?.lease === lease;
	}

	isOwner(owner: Owner): boolean {
		return this.active?.lease.owner === owner;
	}

	/**
	 * Await preparation without letting an uncooperative promise pin the lease
	 * after Stop or view close. The underlying operation may settle later, but
	 * the cancelled turn cannot continue into transcript writes or controllers.
	 */
	waitFor<T>(lease: ForegroundTurnLease<Owner>, operation: Promise<T>): Promise<T> {
		if (!this.isCurrent(lease) || lease.signal.aborted) {
			return Promise.reject(new ForegroundTurnCancelledError());
		}
		return new Promise<T>((resolve, reject) => {
			const onAbort = (): void => {
				lease.signal.removeEventListener("abort", onAbort);
				reject(new ForegroundTurnCancelledError());
			};
			lease.signal.addEventListener("abort", onAbort, { once: true });
			operation.then(
				(value) => {
					lease.signal.removeEventListener("abort", onAbort);
					if (this.isCurrent(lease) && !lease.signal.aborted) resolve(value);
					else reject(new ForegroundTurnCancelledError());
				},
				(error: unknown) => {
					lease.signal.removeEventListener("abort", onAbort);
					reject(asError(error));
				},
			);
		});
	}

	/**
	 * Cancel only the named lease. Cancellation aborts local preparation before
	 * awaiting controller cleanup and is idempotent for repeated Stop gestures.
	 * The turn itself releases the lease in its finally block.
	 */
	async cancel(
		lease: ForegroundTurnLease<Owner>,
		cancelOwnedWork: () => void | Promise<void>,
	): Promise<boolean> {
		const active = this.active;
		if (!active || active.lease !== lease) return false;
		if (!active.cancellation) {
			active.abortController.abort();
			try {
				active.cancellation = Promise.resolve(cancelOwnedWork());
			} catch (error) {
				active.cancellation = Promise.reject(asError(error));
			}
		}
		await active.cancellation;
		return true;
	}

	/** Release succeeds only for the currently-held identity. */
	release(lease: ForegroundTurnLease<Owner>): boolean {
		if (this.active?.lease !== lease) return false;
		this.active = null;
		return true;
	}
}
