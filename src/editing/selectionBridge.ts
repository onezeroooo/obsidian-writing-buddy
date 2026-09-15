/**
 * Coordinates the live editor selection with a conversation attachment.
 *
 * This module deliberately knows nothing about Obsidian, editors, or storage.
 * The host supplies snapshots and persistence; the coordinator only owns the
 * timing and ordering rules that are easy to get wrong at the UI boundary:
 * debounce noisy cursor gestures, bind a change to the conversation that was
 * active when it happened, and suppress observations caused by navigation.
 */

export interface SelectionBridgePort<T> {
	activeSessionId(): string | null;
	ensureActiveSessionId(): Promise<string>;
	currentSelection(sessionId: string): T | null;
	writeSelection(sessionId: string, selection: T | null): Promise<void>;
	equals(left: T, right: T): boolean;
	onApplied?(sessionId: string, selection: T | null): void;
	onError?(error: unknown): void;
}

/** Opaque binding captured before asynchronous navigation starts. */
export interface ProgrammaticSelectionTarget {
	readonly token: number;
}

interface BoundTarget {
	readonly activeAtStart: string | null;
	readonly conversationEpoch: number;
	/** Later explicit/user selection authority invalidates an older queued write. */
	readonly selectionEpoch: number;
	readonly sessionId: Promise<string>;
}

interface PendingSelection<T> {
	readonly target: BoundTarget;
	readonly selection: T | null;
}

const DEFAULT_DEBOUNCE_MS = 100;

export interface SelectionUpdateFacts {
	selectionSet: boolean;
	focusChanged: boolean;
	hasFocus: boolean;
	userSelection: boolean;
	userEdit: boolean;
	programmaticSelection: boolean;
}

/** Blur into another surface is not a collapsed editor selection. */
export function shouldObserveSelectionUpdate(update: SelectionUpdateFacts): boolean {
	if (update.focusChanged && !update.hasFocus) return false;
	return (update.userSelection || update.userEdit) && update.hasFocus && !update.programmaticSelection;
}

/** A retained native range is hidden whenever it is not the current attachment. */
export function shouldHideNativeSelection(
	hasNativeSelection: boolean,
	nativeMatchesAttachment: boolean,
): boolean {
	return hasNativeSelection && !nativeMatchesAttachment;
}

export class SelectionBridgeCoordinator<T> {
	private readonly targets = new Map<number, BoundTarget>();
	private nextTarget = 1;
	private conversationEpoch = 0;
	private selectionEpoch = 0;
	private pending: PendingSelection<T> | null = null;
	private debounceTimer: number | null = null;
	private suppressionTimer: number | null = null;
	private programmaticDepth = 0;
	private ignoredSelection: T | null | undefined;
	private writeChain: Promise<void> = Promise.resolve();
	private queuedWrites = 0;
	private disposed = false;

	constructor(
		private readonly port: SelectionBridgePort<T>,
		private readonly debounceMs = DEFAULT_DEBOUNCE_MS,
	) {}

	/**
	 * Record a selection produced by a real editor gesture. Repeated browser
	 * cursor notifications coalesce into one vault write. A null snapshot is an
	 * intentional collapsed caret and therefore clears the live attachment.
	 */
	observeUserSelection(selection: T | null): void {
		if (this.disposed || this.programmaticDepth > 0) return;

		if (this.ignoredSelection !== undefined) {
			if (
				this.ignoredSelection !== null &&
				selection !== null &&
				this.port.equals(this.ignoredSelection, selection)
			) return;
			this.clearSuppression();
		}

		this.cancelPending();
		this.selectionEpoch += 1;
		this.pending = { target: this.bindActiveSession(), selection };
		this.debounceTimer = window.setTimeout(() => {
			this.debounceTimer = null;
			const pending = this.pending;
			this.pending = null;
			if (pending) void this.enqueue(pending.target, pending.selection);
		}, this.debounceMs);
	}

	/**
	 * Bind navigation to the conversation in front of the writer at click time.
	 * Opening a file may take several ticks; looking the session up afterwards
	 * could attach its passage to a conversation selected in the meantime.
	 */
	beginProgrammaticSelection(): ProgrammaticSelectionTarget {
		const token = this.nextTarget++;
		// A later click supersedes an earlier navigation that is still opening a
		// file. Only the latest explicit destination may become the attachment.
		this.targets.clear();
		this.selectionEpoch += 1;
		this.targets.set(token, this.bindActiveSession());
		this.cancelPending();
		this.programmaticDepth = 1;
		return { token };
	}

	isProgrammaticSelectionCurrent(target: ProgrammaticSelectionTarget): boolean {
		const bound = this.targets.get(target.token);
		if (!bound || bound.conversationEpoch !== this.conversationEpoch) return false;
		return bound.activeAtStart === null || this.port.activeSessionId() === bound.activeAtStart;
	}

	/**
	 * Complete programmatic navigation with the snapshot the editor actually
	 * accepted. Passing null ends suppression without changing the attachment.
	 */
	finishProgrammaticSelection(
		target: ProgrammaticSelectionTarget,
		selection: T | null,
	): Promise<void> {
		const bound = this.targets.get(target.token);
		if (!bound) return Promise.resolve();
		this.targets.delete(target.token);
		this.programmaticDepth = Math.max(0, this.programmaticDepth - 1);

		if (this.disposed || selection === null) {
			return Promise.resolve();
		}

		this.armPostProgrammaticSuppression(selection);
		return this.enqueue(bound, selection);
	}

	/** End a failed/abandoned navigation without treating focus churn as input. */
	cancelProgrammaticSelection(target: ProgrammaticSelectionTarget): void {
		if (!this.targets.delete(target.token)) return;
		this.programmaticDepth = Math.max(0, this.programmaticDepth - 1);
	}

	/**
	 * A conversation switch is not an editor selection gesture. Drop a pending
	 * debounced observation so it cannot be reinterpreted after the switch.
	 */
	conversationChanged(): void {
		this.conversationEpoch += 1;
		this.selectionEpoch += 1;
		this.cancelPending();
		this.cancelProgrammaticTargets();
	}

	/**
	 * An explicit host-side attach/clear supersedes every older editor gesture,
	 * including one whose asynchronous write has already started. The host has
	 * performed the explicit mutation before calling this method, so capture that
	 * authoritative value and reassert it after the queue only if an older write
	 * managed to finish later. A subsequent genuine editor gesture receives a
	 * newer epoch and supersedes this reconciliation in turn.
	 */
	attachmentChangedExternally(): void {
		this.selectionEpoch += 1;
		this.cancelPending();
		this.cancelProgrammaticTargets();
		if (this.disposed || this.queuedWrites === 0) return;
		const sessionId = this.port.activeSessionId();
		if (!sessionId) return;
		const selection = this.port.currentSelection(sessionId);
		const target: BoundTarget = {
			activeAtStart: sessionId,
			conversationEpoch: this.conversationEpoch,
			selectionEpoch: this.selectionEpoch,
			sessionId: Promise.resolve(sessionId),
		};
		// An in-flight older write cannot be cancelled through this generic port.
		// Queueing the authoritative snapshot makes the final persisted state
		// deterministic without overwriting a still newer gesture.
		void this.enqueue(target, selection, true).catch(() => undefined);
	}

	/** Wait for already-enqueued persistence; useful to make tests deterministic. */
	settled(): Promise<void> {
		return this.writeChain;
	}

	/**
	 * Persist the latest debounced editor selection now. Send paths call this
	 * before reading the active session so a quick select-then-send gesture can
	 * never use the previous attachment. Existing session/epoch guards still
	 * apply because the pending observation goes through the normal queue.
	 */
	flushPending(): Promise<void> {
		if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
		this.debounceTimer = null;
		const pending = this.pending;
		this.pending = null;
		if (pending && !this.disposed) return this.enqueue(pending.target, pending.selection);
		return this.writeChain;
	}

	dispose(): void {
		this.disposed = true;
		this.selectionEpoch += 1;
		this.cancelPending();
		this.clearSuppression();
		this.targets.clear();
		this.programmaticDepth = 0;
	}

	private bindActiveSession(): BoundTarget {
		const current = this.port.activeSessionId();
		const epoch = this.conversationEpoch;
		return {
			activeAtStart: current,
			conversationEpoch: epoch,
			selectionEpoch: this.selectionEpoch,
			sessionId: current ? Promise.resolve(current) : this.port.ensureActiveSessionId(),
		};
	}

	private enqueue(target: BoundTarget, selection: T | null, force = false): Promise<void> {
		// A failed write must reject the caller that flushes before send, while a
		// later independent selection still gets a chance to persist.
		this.queuedWrites += 1;
		const run = this.writeChain.catch(() => undefined).then(async () => {
			if (this.disposed) return;
			const sessionId = await target.sessionId;
			if (this.disposed) return;
			// The click/gesture belongs to the conversation that was visible when it
			// began. If the writer switched meanwhile, discard it entirely: updating
			// the old conversation invisibly is just as surprising as updating the new.
			if (target.conversationEpoch !== this.conversationEpoch) return;
			if (target.selectionEpoch !== this.selectionEpoch) return;
			if (target.activeAtStart && this.port.activeSessionId() !== target.activeAtStart) return;
			const current = this.port.currentSelection(sessionId);
			if (!force && sameNullable(current, selection, (a, b) => this.port.equals(a, b))) return;
			await this.port.writeSelection(sessionId, selection);
			// The write may have been overtaken while awaiting persistence. Never
			// publish its stale result; the newer queued authority will reconcile it.
			if (target.selectionEpoch !== this.selectionEpoch) return;
			this.port.onApplied?.(sessionId, selection);
		}).finally(() => {
			this.queuedWrites = Math.max(0, this.queuedWrites - 1);
		});
		this.writeChain = run;
		void run.catch((error) => this.port.onError?.(error));
		return run;
	}

	private cancelPending(): void {
		if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
		this.debounceTimer = null;
		this.pending = null;
	}

	private armPostProgrammaticSuppression(selection: T): void {
		this.clearSuppression();
		this.ignoredSelection = selection;
		this.suppressionTimer = window.setTimeout(() => this.clearSuppression(), this.debounceMs);
	}

	private cancelProgrammaticTargets(): void {
		this.targets.clear();
		this.programmaticDepth = 0;
		this.clearSuppression();
	}

	private clearSuppression(): void {
		if (this.suppressionTimer !== null) window.clearTimeout(this.suppressionTimer);
		this.suppressionTimer = null;
		this.ignoredSelection = undefined;
	}
}

function sameNullable<T>(left: T | null, right: T | null, equals: (a: T, b: T) => boolean): boolean {
	if (left === null || right === null) return left === right;
	return equals(left, right);
}
