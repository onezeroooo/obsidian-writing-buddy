/**
 * The vocabulary of novel knowledge, owned by Writing Buddy.
 *
 * Recanta stores evidence, reconciles facts and retrieves; it knows nothing
 * about chapters, point of view or canon. Everything a novel needs on top of
 * that is expressed here as conventions the adapter writes and reads back:
 * which Recanta scope a piece of knowledge lives in, which subject tags carry
 * story position and point of view, and which canonical predicate prefixes
 * name the kind of fact. Nothing in this file talks to Recanta; it only
 * names things.
 *
 * Two of Recanta's rules shape these conventions. A candidate's subject,
 * predicate and value must occur verbatim inside the sentence it rests on, so
 * the kind of a fact cannot be written into the predicate by the extractor;
 * it arrives through Recanta's predicate vocabulary, which maps a raw mention
 * (`藏在`) to a canonical predicate (`state.位置`). And a slot holds one
 * current value: two different values are a preserved conflict, not a
 * sequence. Story time therefore never lives in the slot. It lives on the
 * source, as Recanta's sortable position (the boundary it withholds by), and
 * the adapter reads a conflicting slot back as a trajectory ordered by the
 * position of each claim's evidence.
 *
 * Identifiers stay within `[a-z0-9-]` because they travel as Recanta scope,
 * source and subject ids and as file names inside the Vault.
 */

export type NovelKnowledgeKind =
	| "author-canon"
	| "manuscript-event"
	| "narrative-state"
	| "pov-knowledge"
	| "relationship-trajectory"
	| "open-thread"
	| "derived-observation"
	| "explicit-correction";

export const NOVEL_KNOWLEDGE_KINDS: readonly NovelKnowledgeKind[] = Object.freeze([
	"explicit-correction",
	"author-canon",
	"narrative-state",
	"manuscript-event",
	"relationship-trajectory",
	"open-thread",
	"pov-knowledge",
	"derived-observation",
]);

/**
 * Authority order, highest first. A lower kind never overwrites a higher one:
 * when two kinds disagree about the same subject and predicate, the higher
 * kind is stated and the lower one is reported as a contradiction.
 */
export function kindAuthority(kind: NovelKnowledgeKind): number {
	return NOVEL_KNOWLEDGE_KINDS.indexOf(kind);
}

/** The four Recanta scopes one book uses. Point of view is a subject tag, not a scope. */
export type NovelScopeRole = "canon" | "story" | "corrections" | "derived";

export const NOVEL_SCOPE_ROLES: readonly NovelScopeRole[] = Object.freeze(["canon", "story", "corrections", "derived"]);

export function novelScope(bookId: string, role: NovelScopeRole): string {
	return `wb-${bookId}-${role}`;
}

export function novelScopes(bookId: string): string[] {
	return NOVEL_SCOPE_ROLES.map((role) => novelScope(bookId, role));
}

export function scopeRole(bookId: string, scopeId: string): NovelScopeRole | null {
	const prefix = `wb-${bookId}-`;
	if (!scopeId.startsWith(prefix)) return null;
	const role = scopeId.slice(prefix.length);
	return (NOVEL_SCOPE_ROLES as readonly string[]).includes(role) ? (role as NovelScopeRole) : null;
}

/**
 * Where a piece of text sits in the story: the document's order within the
 * manuscript scope and the chunk's order within the document. Both are
 * zero-based so that "before the first word" is a representable position.
 */
export interface StoryPosition {
	ordinal: number;
	chunk: number;
}

export function comparePositions(left: StoryPosition, right: StoryPosition): number {
	return left.ordinal - right.ordinal || left.chunk - right.chunk;
}

/**
 * Recanta compares positions lexicographically, so the key is zero-padded:
 * `00003.00001` is chapter order 3, chunk 1. It is what a source carries and
 * what a recall boundary names.
 */
export function positionKey(position: StoryPosition): string {
	return `${pad(position.ordinal)}.${pad(position.chunk)}`;
}

export function parsePositionKey(key: string): StoryPosition | null {
	const match = /^(\d{1,6})\.(\d{1,6})$/u.exec(key);
	return match ? { ordinal: Number(match[1]), chunk: Number(match[2]) } : null;
}

export function povTag(pov: string): string {
	return `pov-${slug(pov)}`;
}

export function povOf(subjectIds: readonly string[]): string | null {
	const tag = subjectIds.find((value) => value.startsWith("pov-"));
	return tag ? tag.slice("pov-".length) : null;
}

/**
 * Canonical predicate prefixes that name a kind inside the story scope.
 * Recanta's predicate vocabulary maps raw mentions onto these; a canonical
 * predicate without a prefix is current narrative state.
 */
export const STORY_PREDICATE_PREFIXES: Readonly<Record<string, NovelKnowledgeKind>> = Object.freeze({
	"event.": "manuscript-event",
	"state.": "narrative-state",
	"relationship.": "relationship-trajectory",
	"thread.": "open-thread",
	"knows": "pov-knowledge",
	"believes": "pov-knowledge",
});

export function kindOfFact(role: NovelScopeRole, predicate: string): NovelKnowledgeKind {
	if (role === "canon") return "author-canon";
	if (role === "corrections") return "explicit-correction";
	if (role === "derived") return "derived-observation";
	for (const [prefix, kind] of Object.entries(STORY_PREDICATE_PREFIXES)) {
		if (predicate.startsWith(prefix)) return kind;
	}
	return "narrative-state";
}

/** `knows…` and `believes…` belong to one character; everyone else must not see them. */
export function isPrivateKnowledge(predicate: string): boolean {
	return predicate.startsWith("knows") || predicate.startsWith("believes");
}

/**
 * Kinds whose value changes as the story moves: where an object is, whether a
 * thread is open, what a character believes, what someone did and did again.
 * A slot of one of these kinds that holds several claims is a sequence in
 * story time, not a contradiction. Only canon and explicit corrections state
 * one timeless value.
 */
export function isTimeVarying(kind: NovelKnowledgeKind): boolean {
	return kind === "narrative-state" || kind === "manuscript-event" || kind === "open-thread" || kind === "pov-knowledge" || kind === "relationship-trajectory";
}

/** The predicate without its kind prefix, for display and cross-kind comparison. */
export function barePredicate(predicate: string): string {
	for (const prefix of Object.keys(STORY_PREDICATE_PREFIXES)) {
		if (predicate.startsWith(prefix)) return predicate.slice(prefix.length).replace(/^\./u, "");
	}
	return predicate;
}

/**
 * Writing Buddy's default predicate vocabulary: raw mentions a Chinese or
 * English manuscript uses for the things a novel tracks, mapped onto the
 * canonical predicates above. Recanta applies it during normalization; a book
 * may extend it from its canon. Mentions not listed here stay raw and are
 * read as narrative state.
 */
export const DEFAULT_PREDICATE_VOCABULARY: Readonly<Record<string, string>> = Object.freeze({
	"藏在": "state.位置", "放在": "state.位置", "在": "state.位置", "位于": "state.位置", "is at": "state.位置", "is in": "state.位置", "lies in": "state.位置",
	"知道": "knows", "得知": "knows", "看见": "knows", "knows": "knows", "learns": "knows",
	"以为": "believes", "相信": "believes", "认为": "believes", "believes": "believes", "thinks": "believes",
	"离开": "event.离开", "leaves": "event.离开", "到达": "event.到达", "arrives": "event.到达",
	"送到": "thread.送达", "送达": "thread.送达",
	"信任": "relationship.信任", "trusts": "relationship.信任", "猜疑": "relationship.猜疑", "怀疑": "relationship.猜疑", "suspects": "relationship.猜疑",
	"爱": "relationship.爱", "loves": "relationship.爱", "恨": "relationship.恨", "hates": "relationship.恨",
});

/** A stable, file- and id-safe form of a name. Chinese and other scripts are hashed, not dropped. */
export function slug(value: string): string {
	const ascii = value.trim().toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "");
	if (ascii.length > 0 && ascii.length <= 40 && /^[a-z0-9-]+$/u.test(ascii) && ascii === value.trim().toLowerCase()) return ascii;
	return `x${fnv1a(value.trim())}`;
}

/** 32-bit FNV-1a as lowercase hex: short, deterministic, and the same on every device. */
export function fnv1a(text: string): string {
	let hash = 0x811c9dc5;
	for (const char of text) {
		hash ^= char.codePointAt(0) ?? 0;
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).padStart(8, "0");
}

function pad(value: number): string {
	return String(Math.max(0, Math.floor(value))).padStart(5, "0");
}
