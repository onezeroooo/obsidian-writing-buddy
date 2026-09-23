/**
 * The one place Writing Buddy speaks to Recanta.
 *
 * Recanta owns evidence, extraction, reconciliation, retrieval, the
 * story-position boundary and the portable artifacts. Writing Buddy owns what
 * a novel means: which text is canon and which is manuscript, where in the
 * story a chunk sits, whose point of view it belongs to, which kinds of fact
 * outrank which, and how a slot that holds several positioned values reads
 * as a trajectory. This adapter translates between the two through Recanta's
 * host contract (`docs/host-contract.md` in the Recanta repository) without
 * either side learning the other's internals.
 *
 * Every manuscript chunk is one Recanta document with a stable identity, a
 * strictly increasing revision, a sortable position and the chapter's point
 * of view as a subject tag. Canon notes and explicit corrections are
 * unpositioned documents in their own scopes, so they are visible from every
 * position and ranked above the manuscript by this adapter, not by Recanta.
 */

import { type DocumentReceipt, type DocumentState, type ExportResult, type ImportReport, type LifecycleReceipt, type PortableArtifact, type RecallBody, parseArtifact } from "recanta-dev";
import type { NovelMemoryEngine } from "./recantaEngine";
import {
	type NovelKnowledgeKind,
	type NovelScopeRole,
	type StoryPosition,
	barePredicate,
	comparePositions,
	isPrivateKnowledge,
	isTimeVarying,
	kindAuthority,
	kindOfFact,
	novelScope,
	novelScopes,
	parsePositionKey,
	positionKey,
	povTag,
	scopeRole,
	slug,
} from "./novelKinds";

export type { RecallBody } from "recanta-dev";

type RecallFact = RecallBody["facts"][number];
type RecallClaim = RecallFact["claims"][number];
type Citation = RecallBody["evidence"][number]["citation"];

// ---------------------------------------------------------------------------
// What Writing Buddy hands the adapter
// ---------------------------------------------------------------------------

export interface ManuscriptChunkInput {
	docId: string;
	/** Zero-based chunk index within the document. */
	chunk: number;
	/** The document's revision counter; strictly increasing per document. */
	version: number;
	position: StoryPosition;
	text: string;
	pov?: string | null;
}

export interface CanonInput {
	docId: string;
	version: number;
	text: string;
}

export interface CorrectionInput {
	/** Stable id for the correction note; a re-issued correction takes a new version. */
	id: string;
	version: number;
	text: string;
}

export interface RecallRequest {
	query: string;
	/** Only knowledge at or before this position is returned; absent means the whole story so far. */
	position?: StoryPosition | null;
	/** Private knowledge (`knows…` / `believes…`) is returned only for this character. */
	pov?: string | null;
	maxBytes?: number;
	limit?: number;
}

export interface NovelKnowledgeEntry {
	kind: NovelKnowledgeKind;
	subject: string;
	/** The canonical predicate as Recanta holds it. */
	predicate: string;
	values: string[];
	status: RecallFact["status"];
	/** Where in the story the current value holds from: the latest supporting evidence the caller may see. */
	position: StoryPosition | null;
	evidenceIds: string[];
	/** Earlier steps of a time-varying slot, oldest first, each with the position it held from. */
	history?: Array<{ position: StoryPosition | null; values: string[] }>;
	/** Every position at which the manuscript states one of the entry's values, for trajectories across slots. */
	points?: Array<{ position: StoryPosition | null; value: string }>;
}

export interface NovelContradiction {
	subject: string;
	predicate: string;
	stated: NovelKnowledgeEntry;
	contradicted: NovelKnowledgeEntry;
}

export interface NovelEvidenceExcerpt {
	sourceId: string;
	docId: string | null;
	chunk: number | null;
	position: StoryPosition | null;
	text: string;
	role: NovelScopeRole | null;
	citation: Citation;
}

export interface NovelContext {
	query: string;
	position: StoryPosition | null;
	pov: string | null;
	entries: NovelKnowledgeEntry[];
	contradictions: NovelContradiction[];
	evidence: NovelEvidenceExcerpt[];
	/** Private knowledge withheld because it belongs to another point of view. */
	withheldPrivate: number;
	ready: boolean;
	version: number;
}

export interface AdapterOptions {
	/** Who the trusted host says wrote canon and corrections. */
	authorId?: string;
	maxBytes?: number;
	limit?: number;
}

export const MANUSCRIPT_STREAM = "writing-buddy-manuscript";
export const CANON_STREAM = "writing-buddy-canon";
export const CORRECTION_STREAM = "writing-buddy-corrections";

/** Source ids for the three streams. `chunk` is part of the id; position is not. */
export function chunkSourceId(docId: string, chunk: number): string {
	return `${docId}-c${String(chunk).padStart(3, "0")}`;
}
export function canonSourceId(docId: string): string {
	return `${docId}-canon`;
}
export function correctionSourceId(id: string): string {
	return `corr-${slug(id)}`;
}
export function parseChunkSourceId(sourceId: string): { docId: string; chunk: number } | null {
	const match = /^(d[0-9a-f]{16})-c(\d{3,})$/u.exec(sourceId);
	return match ? { docId: match[1], chunk: Number(match[2]) } : null;
}

/** The bundle a source belongs to: a document id, or `corr:<slug>` for a correction. */
export function documentKeyOf(sourceId: string): string | null {
	const chunk = parseChunkSourceId(sourceId);
	if (chunk) return chunk.docId;
	const canon = /^(d[0-9a-f]{16})-canon$/u.exec(sourceId);
	if (canon) return canon[1];
	if (sourceId.startsWith("corr-")) return `corr:${sourceId.slice("corr-".length)}`;
	return null;
}

/** One claim at one of the positions that state it: the unit trajectory ordering works on. */
interface PlacedClaim {
	claim: RecallClaim;
	position: StoryPosition | null;
}

export class WritingBuddyRecantaAdapter {
	readonly access: { namespaceId: string; readScopes: string[]; writeScopes: string[] };
	private readonly authorId: string;
	private readonly maxBytes: number;
	private readonly limit: number;

	constructor(
		private readonly engine: NovelMemoryEngine,
		readonly bookId: string,
		options: AdapterOptions = {},
	) {
		if (!/^[a-z0-9]{4,32}$/u.test(bookId)) throw new Error("A book id is lowercase letters and digits.");
		const scopes = novelScopes(bookId);
		this.access = { namespaceId: `wb-${bookId}`, readScopes: scopes, writeScopes: scopes };
		this.authorId = options.authorId ?? "author";
		this.maxBytes = options.maxBytes ?? 32_000;
		this.limit = options.limit ?? 8;
	}

	get scopes(): string[] {
		return this.access.readScopes;
	}

	// ---- documents ---------------------------------------------------------

	/**
	 * Manuscript text is what the story says. It is retained as a document
	 * actor with approved authority: Recanta's default policy accepts
	 * non-personal state only from an approved source, and Writing Buddy, as
	 * the trusted host, vouches that the manuscript is the record of its own
	 * story. That the writer's canon outranks the manuscript is not Recanta's
	 * concern — the two live in different scopes and the adapter orders them.
	 * Position is Recanta's boundary key; point of view travels as a subject
	 * tag so a later reader can filter on it.
	 */
	retainManuscriptChunk(input: ManuscriptChunkInput): Promise<DocumentReceipt> {
		assertText(input.text);
		return this.engine.retainDocument(this.access, {
			scopeId: novelScope(this.bookId, "story"),
			sourceId: chunkSourceId(input.docId, input.chunk),
			revision: input.version,
			content: input.text,
			position: positionKey(input.position),
			kind: "document_revision",
			subjectIds: input.pov ? [povTag(input.pov)] : [],
			streamId: MANUSCRIPT_STREAM,
			metadata: { actorId: "manuscript", actorType: "document", authority: "approved" },
		}, { onStale: "ignore" });
	}

	/** Author canon is the writer's word: a person actor with approved authority, in its own unpositioned scope. */
	retainCanon(input: CanonInput): Promise<DocumentReceipt> {
		assertText(input.text);
		return this.engine.retainDocument(this.access, {
			scopeId: novelScope(this.bookId, "canon"),
			sourceId: canonSourceId(input.docId),
			revision: input.version,
			content: input.text,
			kind: "document_revision",
			streamId: CANON_STREAM,
			metadata: { actorId: this.authorId, actorType: "person", authority: "approved" },
		}, { onStale: "ignore" });
	}

	/** An explicit correction outranks everything, including canon it corrects. */
	retainCorrection(input: CorrectionInput): Promise<DocumentReceipt> {
		assertText(input.text);
		return this.engine.retainDocument(this.access, {
			scopeId: novelScope(this.bookId, "corrections"),
			sourceId: correctionSourceId(input.id),
			revision: input.version,
			content: input.text,
			kind: "correction",
			streamId: CORRECTION_STREAM,
			metadata: { actorId: this.authorId, actorType: "person", authority: "approved" },
		}, { onStale: "ignore" });
	}

	/** Retire a document's chunks in `[from, until)`; a document that shrank keeps its earlier chunks. */
	deleteChunks(docId: string, from: number, until: number): LifecycleReceipt[] {
		const receipts: LifecycleReceipt[] = [];
		for (let chunk = from; chunk < until; chunk += 1) {
			const receipt = this.lifecycle(() => this.engine.deleteDocument(this.access, novelScope(this.bookId, "story"), chunkSourceId(docId, chunk), { reason: "left the manuscript" }));
			if (receipt) receipts.push(receipt);
		}
		return receipts;
	}

	deleteCanon(docId: string): LifecycleReceipt | null {
		return this.lifecycle(() => this.engine.deleteDocument(this.access, novelScope(this.bookId, "canon"), canonSourceId(docId), { reason: "left the canon" }));
	}

	/** A document that came back with the text it left with: memory returns without a model call. */
	restoreChunks(docId: string, count: number): void {
		for (let chunk = 0; chunk < count; chunk += 1) this.lifecycle(() => this.engine.restoreDocument(this.access, novelScope(this.bookId, "story"), chunkSourceId(docId, chunk)));
	}

	restoreCanon(docId: string): void {
		this.lifecycle(() => this.engine.restoreDocument(this.access, novelScope(this.bookId, "canon"), canonSourceId(docId)));
	}

	chunkState(docId: string, chunk: number): DocumentState | null {
		try {
			return this.engine.documentState(this.access, novelScope(this.bookId, "story"), chunkSourceId(docId, chunk));
		} catch {
			return null;
		}
	}

	/** The engine's view of one processing run; null when the id is unknown to it. */
	processingRun(processingId: string) {
		try {
			return this.engine.processingStatus(this.access, processingId);
		} catch {
			return null;
		}
	}

	/** Ask the engine to process a failed run again (a new attempt against the same evidence). */
	retryProcessing(processingId: string) {
		return this.engine.retryProcessing(this.access, processingId);
	}

	private lifecycle(action: () => LifecycleReceipt): LifecycleReceipt | null {
		try {
			return action();
		} catch {
			// Unknown to the engine (never retained here, or already gone): nothing to transition.
			return null;
		}
	}

	// ---- portable artifacts -----------------------------------------------

	/** Everything committed after `afterVersion`, as immutable files Recanta names. */
	exportSince(afterVersion: number): ExportResult {
		return this.engine.exportArtifacts(this.access, { scopes: this.scopes, afterVersion });
	}

	/** Apply files from any device; idempotent, order-tolerant, model-free. */
	import(artifacts: readonly PortableArtifact[]): ImportReport {
		return this.engine.importArtifacts(this.access, artifacts);
	}

	/**
	 * Which Writing Buddy document each Recanta artifact concerns, so the host
	 * can pack artifacts into one bundle per source. Evidence and lifecycle
	 * name their source directly; runs and fact transitions name evidence, which
	 * the engine resolves to its source. Artifacts the engine cannot place (a
	 * foreign or torn file) are returned under `null`.
	 */
	groupByDocument(artifacts: readonly PortableArtifact[]): Map<string | null, PortableArtifact[]> {
		const groups = new Map<string | null, PortableArtifact[]>();
		const sourceOf = (evidenceId: string): string | null => {
			try {
				return this.engine.evidence(this.access, evidenceId).sourceId;
			} catch {
				return null;
			}
		};
		for (const artifact of artifacts) {
			let sourceId: string | null = null;
			const parsed = parseArtifact(artifact.text);
			if (parsed.ok) {
				const body = parsed.envelope.body as Record<string, unknown>;
				switch (parsed.envelope.kind) {
					case "evidence": sourceId = typeof (body.evidence as { sourceId?: unknown })?.sourceId === "string" ? (body.evidence as { sourceId: string }).sourceId : null; break;
					case "lifecycle": sourceId = typeof body.sourceId === "string" ? body.sourceId : null; break;
					case "run": sourceId = typeof (body.run as { evidenceId?: unknown })?.evidenceId === "string" ? sourceOf((body.run as { evidenceId: string }).evidenceId) : null; break;
					case "fact": {
						const ids = (body.revision as { evidenceIds?: unknown })?.evidenceIds;
						sourceId = Array.isArray(ids) && typeof ids[0] === "string" ? sourceOf(ids[0]) : null;
						break;
					}
				}
			}
			const key = sourceId ? documentKeyOf(sourceId) : null;
			const list = groups.get(key) ?? [];
			list.push(artifact);
			groups.set(key, list);
		}
		return groups;
	}

	engineInfo() {
		return this.engine.engineInfo();
	}

	rebuildLocalState() {
		return this.engine.rebuildLocalState();
	}

	health() {
		return this.engine.healthState(this.access, this.scopes);
	}

	// ---- recall ------------------------------------------------------------

	/**
	 * Ask Recanta at the writer's position, then apply the novel's own
	 * boundaries to what comes back.
	 *
	 * Position: Recanta withholds every source positioned after the boundary
	 * and reconstructs fact slots as of it. What remains may still hold
	 * several positioned values for one slot; a time-varying slot is read as a
	 * sequence, the latest visible claim being the current value and the
	 * earlier ones its history. Point of view: `knows…` and `believes…` facts
	 * belong to their subject; asked as someone else, they are withheld.
	 * Authority: kinds are ordered, and a lower kind that disagrees with a
	 * higher one about the same subject and predicate is reported as a
	 * contradiction rather than stated as knowledge. Claims whose support
	 * was revised are never stated as values.
	 */
	async recall(request: RecallRequest): Promise<NovelContext> {
		const query = request.query.trim();
		if (!query) throw new Error("A recall query must be non-empty.");
		const position = request.position ?? null;
		const result = this.engine.recallContext(this.access, {
			query,
			scopes: this.scopes,
			maxBytes: request.maxBytes ?? this.maxBytes,
			sourceLimit: request.limit ?? this.limit,
			// Point of view and authority are applied after recall, so ask for more slots than a turn will show.
			factLimit: 16,
			...(position ? { boundary: { position: positionKey(position) } } : {}),
		});
		const body = JSON.parse(result.text) as RecallBody;
		const positions = new Map<string, StoryPosition | null>();
		const positionOfSource = (scopeId: string, sourceId: string): StoryPosition | null => {
			const key = `${scopeId} ${sourceId}`;
			if (!positions.has(key)) {
				let placed: StoryPosition | null = null;
				try {
					const state = this.engine.documentState(this.access, scopeId, sourceId);
					placed = state.position ? parsePositionKey(state.position) : null;
				} catch {
					placed = null;
				}
				positions.set(key, placed);
			}
			return positions.get(key) ?? null;
		};
		const evidenceSources = new Map<string, { scopeId: string; sourceId: string } | null>();
		const sourceOfEvidence = (evidenceId: string): { scopeId: string; sourceId: string } | null => {
			if (!evidenceSources.has(evidenceId)) {
				try {
					const item = this.engine.evidence(this.access, evidenceId);
					evidenceSources.set(evidenceId, { scopeId: item.scopeId, sourceId: item.sourceId });
				} catch {
					evidenceSources.set(evidenceId, null);
				}
			}
			return evidenceSources.get(evidenceId) ?? null;
		};
		const povSlug = request.pov ? slug(request.pov) : null;
		let withheldPrivate = 0;

		const entries: NovelKnowledgeEntry[] = [];
		for (const fact of body.facts) {
			const role = scopeRole(this.bookId, fact.scopeId);
			if (!role) continue;
			const kind = kindOfFact(role, fact.predicate);
			if (isPrivateKnowledge(fact.predicate) && (!povSlug || slug(fact.subjectId) !== povSlug)) {
				withheldPrivate += 1;
				continue;
			}
			const placed: PlacedClaim[] = [];
			for (const claim of fact.claims) {
				if (!claim.evidenceCurrent) continue;
				// A claim cites every revision that states it; each visible one is a point in the story.
				const positions = claim.evidenceIds
					.map((id) => { const source = sourceOfEvidence(id); return source ? positionOfSource(source.scopeId, source.sourceId) : null; })
					.filter((item): item is StoryPosition => item !== null)
					.filter((item, index, all) => all.findIndex((other) => comparePositions(other, item) === 0) === index);
				if (positions.length === 0) placed.push({ claim, position: null });
				for (const item of positions) placed.push({ claim, position: item });
			}
			if (placed.length === 0) continue;
			entries.push(entryFrom(kind, fact, placed));
		}

		const { stated, contradictions } = resolveAuthority(collapseRelationships(entries));

		const evidence: NovelEvidenceExcerpt[] = [];
		const seen = new Set<string>();
		for (const item of [...body.evidence.filter((entry) => entry.supports.some((support) => support.relation !== "stale_support")), ...body.sources]) {
			const key = `${item.citation.evidenceId}:${item.citation.start}:${item.citation.end}`;
			if (seen.has(key)) continue;
			seen.add(key);
			const source = sourceOfEvidence(item.citation.evidenceId);
			const parsed = parseChunkSourceId(item.citation.sourceId);
			evidence.push({
				sourceId: item.citation.sourceId,
				docId: parsed?.docId ?? null,
				chunk: parsed?.chunk ?? null,
				position: source ? positionOfSource(source.scopeId, source.sourceId) : null,
				text: item.text,
				role: source ? scopeRole(this.bookId, source.scopeId) : null,
				citation: item.citation,
			});
		}

		return {
			query,
			position,
			pov: request.pov ?? null,
			entries: stated,
			contradictions,
			evidence,
			withheldPrivate,
			// Narrative prose outside any statement is an extraction gap, not unfinished work; only runs
			// still requested or in flight make the knowledge incomplete for a turn.
			ready: (body.processing.counts.requested ?? 0) + (body.processing.counts.processing ?? 0) === 0,
			version: body.version,
		};
	}
}

/**
 * One entry from the visible claims of a fact.
 *
 * A time-varying slot is a sequence: claims are ordered by position, the
 * latest is the current value and the earlier distinct values are history.
 * Any other slot keeps Recanta's verdict: its effective values when it
 * resolved, and every competing value with the conflict status when it did
 * not.
 */
export function entryFrom(kind: NovelKnowledgeKind, fact: RecallFact, visible: readonly PlacedClaim[]): NovelKnowledgeEntry {
	const evidenceIds = [...new Set(visible.flatMap((item) => [...item.claim.evidenceIds]))];
	const ordered = [...visible].sort((a, b) => {
		if (a.position && b.position) return comparePositions(a.position, b.position);
		return a.position ? 1 : b.position ? -1 : 0;
	});
	const latest = ordered.length ? ordered[ordered.length - 1].position : null;
	const points = ordered.map((item) => ({ position: item.position, value: String(item.claim.value) }));
	if (isTimeVarying(kind) && visible.length > 1) {
		const steps: Array<{ position: StoryPosition | null; values: string[] }> = [];
		for (const item of ordered) {
			const value = String(item.claim.value);
			const last = steps[steps.length - 1];
			if (last && last.position && item.position && comparePositions(last.position, item.position) === 0) {
				if (!last.values.includes(value)) last.values.push(value);
			} else if (!last || last.values.join(" ") !== value) {
				steps.push({ position: item.position, values: [value] });
			}
		}
		const current = steps[steps.length - 1];
		return {
			kind, subject: fact.subjectId, predicate: fact.predicate, values: current.values, status: "resolved",
			position: latest, evidenceIds, points, ...(steps.length > 1 ? { history: steps.slice(0, -1) } : {}),
		};
	}
	const visibleValues = [...new Set(visible.map((item) => String(item.claim.value)))];
	const values = fact.status === "resolved" && fact.values.length ? fact.values.map(String) : visibleValues.length === 1 ? visibleValues : [];
	return {
		kind, subject: fact.subjectId, predicate: fact.predicate, values,
		status: values.length ? (fact.status === "needs_review" ? "needs_review" : "resolved") : visibleValues.length > 1 ? "conflict" : fact.status,
		position: latest, evidenceIds, points,
	};
}

/**
 * A relationship is a stance one character holds toward another; the stance
 * is the predicate (`relationship.信任`) and the other character is the value.
 * Several stances toward the same person across the story are one
 * trajectory: `信任 → 猜疑`, keyed by the pair, ordered by position.
 */
export function collapseRelationships(entries: readonly NovelKnowledgeEntry[]): NovelKnowledgeEntry[] {
	const groups = new Map<string, NovelKnowledgeEntry[]>();
	const passthrough: NovelKnowledgeEntry[] = [];
	for (const entry of entries) {
		if (entry.kind !== "relationship-trajectory" || entry.values.length !== 1) {
			passthrough.push(entry);
			continue;
		}
		const key = `${slug(entry.subject)} ${slug(entry.values[0])}`;
		const list = groups.get(key) ?? [];
		list.push(entry);
		groups.set(key, list);
	}
	const collapsed: NovelKnowledgeEntry[] = [];
	for (const list of groups.values()) {
		// Every position at which any stance toward this person is stated, in story order.
		const stances = list.flatMap((entry) => (entry.points?.length ? entry.points : [{ position: entry.position, value: "" }]).map((point) => ({ position: point.position, stance: barePredicate(entry.predicate), entry })));
		stances.sort((a, b) => {
			if (a.position && b.position) return comparePositions(a.position, b.position);
			return a.position ? 1 : b.position ? -1 : 0;
		});
		const steps: Array<{ position: StoryPosition | null; values: string[] }> = [];
		for (const item of stances) {
			const last = steps[steps.length - 1];
			if (!last || last.values[0] !== item.stance) steps.push({ position: item.position, values: [item.stance] });
		}
		const latest = stances[stances.length - 1];
		collapsed.push({
			kind: "relationship-trajectory",
			subject: latest.entry.subject,
			predicate: `relationship.${latest.entry.values[0]}`,
			values: [latest.stance],
			status: "resolved",
			position: latest.position,
			evidenceIds: [...new Set(list.flatMap((item) => item.evidenceIds))],
			...(steps.length > 1 ? { history: steps.slice(0, -1) } : {}),
		});
	}
	return [...passthrough, ...collapsed];
}

/**
 * Higher kinds state; lower kinds that disagree are contradictions. Two
 * entries compare when they share a subject and a bare predicate — `state.x`
 * in the manuscript against `x` in canon — and their value sets differ.
 */
export function resolveAuthority(entries: readonly NovelKnowledgeEntry[]): { stated: NovelKnowledgeEntry[]; contradictions: NovelContradiction[] } {
	const bySlot = new Map<string, NovelKnowledgeEntry[]>();
	for (const entry of entries) {
		// What a character knows and what they believe are different slots, not a canon-vs-manuscript pair.
		const comparable = isPrivateKnowledge(entry.predicate) ? entry.predicate : barePredicate(entry.predicate);
		const key = `${slug(entry.subject)} ${comparable}`;
		const list = bySlot.get(key) ?? [];
		list.push(entry);
		bySlot.set(key, list);
	}
	const stated: NovelKnowledgeEntry[] = [];
	const contradictions: NovelContradiction[] = [];
	for (const list of bySlot.values()) {
		const ranked = [...list].sort((a, b) => kindAuthority(a.kind) - kindAuthority(b.kind) || a.predicate.localeCompare(b.predicate) || a.values.join(" ").localeCompare(b.values.join(" ")));
		const top = ranked[0];
		stated.push(top);
		for (const other of ranked.slice(1)) {
			if (sameValues(top.values, other.values)) continue;
			if (top.values.length === 0) {
				// The higher kind is present but unresolved; a lower kind may still speak.
				stated.push(other);
				continue;
			}
			contradictions.push({ subject: top.subject, predicate: barePredicate(top.predicate), stated: top, contradicted: other });
		}
	}
	stated.sort((a, b) => kindAuthority(a.kind) - kindAuthority(b.kind) || a.subject.localeCompare(b.subject) || a.predicate.localeCompare(b.predicate));
	return { stated, contradictions };
}

function sameValues(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) return false;
	const sorted = (values: readonly string[]) => [...values].map((value) => value.trim()).sort();
	const a = sorted(left), b = sorted(right);
	return a.every((value, index) => value === b[index]);
}

function assertText(text: string): void {
	if (!text.trim()) throw new Error("Memory text must be non-empty.");
}
