/**
 * Find what a candidate says that its neighbouring sentence already said.
 *
 * The reported turn: the line before placed a character 在殿门阴影处, and the
 * continuation put them 立在殿门阴影里. Nothing was copied, so the rule against
 * reproducing existing text did not apply; the same fact was simply stated
 * twice. Asking the model to check for this does not work — it is the thing
 * doing the checking, and the writer had already asked several times. The
 * client holds the candidate and the exact surrounding text, so it can check
 * instead. That is where this product puts its guarantees generally: the model
 * owns judgment, the host owns what can actually be verified (PC-006).
 *
 * What this is not: a rule about repetition. A deliberate echo is a device, a
 * name is supposed to recur, and a refrain is not a defect. The output is a
 * warning naming the exact repeated span so the writer can dismiss it at a
 * glance. Nothing here blocks or edits anything.
 */

/**
 * How many tokens must match before a span is worth mentioning.
 *
 * Four, because that is where the reported case sits: 殿门阴影 is four
 * characters and 转身 is two. Below four, ordinary prose collides constantly —
 * 看向, 目光, of the — and the warning becomes something a writer learns to
 * ignore, which is worse than not having it.
 *
 * Its known cost is a proper noun of four characters or more: 散红蘂与风听雨
 * repeated across adjacent sentences is correct writing and will still be
 * reported. The span is shown rather than described precisely so that cost is
 * one glance.
 */
export const MIN_REPEATED_TOKENS = 4;

/**
 * How many sentences on each side count as adjacent.
 *
 * Restating something from three paragraphs back is ordinary writing; doing it
 * in the very next sentence is the defect. Measured on 47 real candidates from
 * the test vault, comparing against a 240-character window instead of the
 * neighbouring sentences was a large part of why the first version fired on
 * more than half of them.
 */
const ADJACENT_SENTENCES = 2;

/**
 * Vocabulary is what the passage uses *elsewhere*, not what it just said.
 *
 * Length alone cannot separate 殿门阴影 from 散红蕖道: both are four tokens, and
 * a Chinese name plus one particle reaches four constantly. What separates them
 * is where else the phrase turns up. A name runs through the whole passage; a
 * phrase that appears only right here, twice, is the echo.
 *
 * So the test is occurrence *outside the adjacent window*, not total count. An
 * earlier version counted everything and inverted its own purpose: a passage
 * that already said 殿门阴影处 twice suppressed the warning about a third,
 * meaning the worse the repetition the quieter this got.
 */
const VOCABULARY_ELSEWHERE = 0;

/**
 * Words that carry no content, trimmed from a span's edges before it is judged.
 *
 * Matching four tokens finds phrases, but it also finds fragments: 了片刻，才
 * and 套干净衣 both reached four on real candidates and neither is a repetition
 * anyone would act on. What makes them fragments is their edges — a particle,
 * half a noun — so the fix is to trim the edges and ask again whether four
 * content tokens remain.
 *
 * Deliberately a short closed list of structural words rather than a
 * dictionary. It only decides where a span begins and ends, so a word missing
 * from it costs a slightly wider span, never a wrong finding.
 */
const FUNCTION_TOKENS = new Set([
	"的", "了", "着", "过", "地", "得", "之", "和", "与", "或", "但", "而", "就", "才", "也", "又", "还",
	"在", "是", "有", "不", "没", "很", "都", "把", "被", "从", "向", "到", "对", "给", "让", "会", "要",
	"个", "这", "那", "上", "下", "里", "中", "他", "她", "它", "我", "你", "们",
	"the", "a", "an", "of", "in", "on", "at", "to", "and", "but", "or", "is", "was", "were", "be", "been",
	"that", "this", "it", "he", "she", "they", "her", "his", "with", "for", "as", "had", "has", "so", "then",
]);

/** A span that runs across one of these is two fragments, not a phrase. */
const CROSSES_BOUNDARY = /[。！？!?\n]/u;

export interface RepeatedSpan {
	/** The repeated text, as it appears in the candidate. */
	text: string;
	/** Which neighbour it came from, for the wording of the warning. */
	side: "before" | "after";
}

export interface AdjacentRepetitionInput {
	/** The candidate text, as it would enter the manuscript. */
	candidate: string;
	/** The passage the candidate replaces, or the one it continues from. */
	selection: string;
	/** Editor text immediately before the selection. */
	before?: string;
	/** Editor text immediately after the selection. */
	after?: string;
	kind: "replace" | "continue";
}

/**
 * Spans the candidate shares with the text it will sit next to, longest first.
 *
 * Which text that is depends on the action, and getting it wrong would make
 * the check useless in one direction and deafening in the other:
 *
 *   - A **replacement** takes the selection's place, so its neighbours are the
 *     surrounding text. It is expected to share wording with the selection —
 *     that is what a rewrite is — so the selection is not compared at all.
 *   - A **continuation** is appended after the selection, so the sentence it
 *     must not echo is the *end of the selection itself*, plus whatever
 *     follows.
 */
export function findAdjacentRepetition(input: AdjacentRepetitionInput): RepeatedSpan[] {
	const candidate = input.candidate.trim();
	if (!candidate) return [];

	const preceding = input.kind === "continue"
		? `${input.before ?? ""}${input.selection}`
		: input.before ?? "";
	const following = input.after ?? "";
	const adjacentBefore = lastSentences(preceding);
	const adjacentAfter = firstSentences(following);
	// Everything that is near but not adjacent. A phrase found here as well is
	// what the passage calls things; one found only in the adjacent sentences is
	// the echo. Two different questions, so two different texts.
	const elsewhere = [
		preceding.slice(0, Math.max(0, preceding.length - adjacentBefore.length)),
		following.slice(adjacentAfter.length),
		input.kind === "replace" ? input.selection : "",
	].join("\n");

	const spans = [
		...matchesAgainst(candidate, adjacentBefore, "before"),
		...matchesAgainst(candidate, adjacentAfter, "after"),
	];

	// Longest first: the longest shared span is the one that says the most, and
	// a shorter one inside it would only restate the same finding.
	spans.sort((left, right) => right.text.length - left.text.length);
	const kept: RepeatedSpan[] = [];
	for (const span of spans) {
		if (kept.some((existing) => existing.text.includes(span.text))) continue;
		if (occurrences(elsewhere, span.text) > VOCABULARY_ELSEWHERE) continue;
		kept.push(span);
	}
	return kept;
}

function occurrences(haystack: string, needle: string): number {
	if (!needle) return 0;
	let count = 0;
	let at = haystack.indexOf(needle);
	while (at !== -1) {
		count += 1;
		at = haystack.indexOf(needle, at + 1);
	}
	return count;
}

function matchesAgainst(candidate: string, neighbour: string, side: RepeatedSpan["side"]): RepeatedSpan[] {
	if (!neighbour.trim()) return [];
	const left = tokenize(candidate);
	const right = tokenize(neighbour);
	if (left.length < MIN_REPEATED_TOKENS || right.length < MIN_REPEATED_TOKENS) return [];

	const rightValues = right.map((token) => token.value);
	const found: RepeatedSpan[] = [];
	let index = 0;
	while (index <= left.length - MIN_REPEATED_TOKENS) {
		const length = longestMatchAt(left, rightValues, index);
		if (length < MIN_REPEATED_TOKENS) {
			index += 1;
			continue;
		}
		const span = contentSpan(candidate, left, index, length);
		if (span) found.push({ text: span, side });
		// Skip past the whole match: an overlapping report of the same words
		// would be the same finding twice.
		index += length;
	}
	return found;
}

/**
 * The phrase inside a token match, or nothing if there is no phrase in it.
 *
 * Trims function words off both ends and requires the remainder to still be
 * long enough to be worth mentioning, then rejects anything running across a
 * sentence or paragraph break. Both tests are about the same thing: a finding
 * a writer can act on is a phrase, not an arbitrary window of four tokens that
 * happened to line up.
 */
function contentSpan(text: string, tokens: Token[], at: number, length: number): string | null {
	let first = at;
	let last = at + length - 1;
	while (first <= last && FUNCTION_TOKENS.has(tokens[first].value)) first += 1;
	while (last >= first && FUNCTION_TOKENS.has(tokens[last].value)) last -= 1;
	if (last - first + 1 < MIN_REPEATED_TOKENS) return null;

	const span = text.slice(tokens[first].start, tokens[last].end);
	return CROSSES_BOUNDARY.test(span) ? null : span;
}

/** The longest run of candidate tokens from `at` that appears in the neighbour. */
function longestMatchAt(left: Token[], right: readonly string[], at: number): number {
	let best = 0;
	for (let start = 0; start < right.length; start += 1) {
		if (right[start] !== left[at].value) continue;
		let length = 1;
		while (
			at + length < left.length &&
			start + length < right.length &&
			right[start + length] === left[at + length].value
		) {
			length += 1;
		}
		best = Math.max(best, length);
	}
	return best;
}

interface Token {
	value: string;
	start: number;
	end: number;
}

/**
 * Tokens that mean something, in either language.
 *
 * A Han character is a token on its own; a run of letters or digits is one
 * token. Punctuation and whitespace are dropped, so 殿门阴影处 and 殿门阴影里
 * share four tokens, and "in the shadow" is three rather than thirteen. This
 * is what lets one threshold be meaningful for Chinese and English at once.
 */
function tokenize(text: string): Token[] {
	const tokens: Token[] = [];
	const pattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+/gu;
	for (const match of text.matchAll(pattern)) {
		const value = match[0];
		const start = match.index ?? 0;
		tokens.push({ value: value.toLowerCase(), start, end: start + value.length });
	}
	return tokens;
}

/**
 * Sentence boundaries in either language, kept deliberately crude.
 *
 * This decides how far "adjacent" reaches, and being approximately right is
 * enough for that. A missed boundary widens the window by one clause; it does
 * not make a finding wrong.
 */
const SENTENCE_END = /[。！？!?…]+["'”’」』)）]*|\n+/gu;

function sentences(text: string): string[] {
	const parts: string[] = [];
	let start = 0;
	for (const match of text.matchAll(SENTENCE_END)) {
		const end = (match.index ?? 0) + match[0].length;
		const piece = text.slice(start, end).trim();
		if (piece) parts.push(piece);
		start = end;
	}
	const rest = text.slice(start).trim();
	if (rest) parts.push(rest);
	return parts;
}

function lastSentences(text: string): string {
	return sentences(text).slice(-ADJACENT_SENTENCES).join("");
}

function firstSentences(text: string): string {
	return sentences(text).slice(0, ADJACENT_SENTENCES).join("");
}
