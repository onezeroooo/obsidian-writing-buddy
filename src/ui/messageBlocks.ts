/**
 * Reading a saved answer back into the thing it was on screen.
 *
 * The bug this exists to kill: an answer would render with its diff, and then
 * the *next* message would flatten it back to plain text. The structure lived in
 * "the latest response" state rather than in the message, so anything that moved
 * on destroyed it — and so did switching conversations, and so did restarting.
 *
 * So structure is derived, every time, from the message itself. An answer is
 * read into prose, citations and rewrite candidates on each render; nothing is
 * remembered except the writer's own decisions (which diff view, whether it has
 * been applied), which are the only parts that are not in the text.
 *
 * A candidate needs a range it can safely be applied to, and there are two
 * ways to get one, neither of which involves guessing:
 *
 *   1. **The passage this turn was about.** The attachment is stored on the
 *      message, so it survives a restart.
 *   2. **An explicit 原文 block.** A reply that quotes an original before its
 *      replacement must quote *this turn's passage*, exactly. Read-only context
 *      may never mint a second editable range, so a quote of anything else
 *      produces no diff rather than one aimed somewhere plausible. Several
 *      candidates in one answer are therefore alternatives for the same
 *      passage, not edits in several places.
 *
 * Anything else — an example, a sketch, one of three alternatives being weighed
 * — stays prose. A fenced block is not on its own evidence of intent to replace:
 * only a labelled one is, unless the block is the entire reply.
 */

import type { ConversationMessage, DocPosition, SelectionAttachment, Skill } from "../types";
import { allFences, CANDIDATE_FENCE_LABELS, SOURCE_FENCE_LABELS, type Fence } from "../editing/rewriteParser";
import { assembleContinuation, assembleReplacement, rewritableCore } from "../editing/applyEdit";
import { findAdjacentRepetition } from "../editing/adjacentRepetition";
import { advancePosition } from "../editing/editor";
import { countChars, previewOf } from "../util/text";
import { diffText } from "../diff/diff";
import type { RewriteCandidate } from "./components/candidateCard";
import type { ContextCitation, ProseSegment } from "./citations";
import { splitProseWithCitations, splitSavedProse, stripCitationMarkers } from "./citations";
import type { DiffViewMode } from "./diffView";

/** One piece of a rendered answer. */
export type MessageBlock =
	| { kind: "prose"; segments: ProseSegment[] }
	| { kind: "candidate"; key: string; candidate: RewriteCandidate };

/** The parts of a candidate that are the writer's choice, not the model's. */
export interface CandidateState {
	mode: DiffViewMode;
	phase: "preview" | "applied";
	token?: RewriteCandidate["token"];
	staleNote?: string;
	/**
	 * The passage as the writer has edited it.
	 *
	 * A model's suggestion is usually nearly right, and the alternative to
	 * editing it here was copying it out, fixing it, and pasting it over the
	 * original by hand — which throws away the exact-range apply and the undo
	 * token along with it. Absent until they type something.
	 */
	editedCore?: string;
	/** Where the passage is now, if it had to be found again. */
	range?: { from: DocPosition; to: DocPosition };
}

export interface PresentOptions {
	message: ConversationMessage;
	/** Evidence ids or saved labels this answer may refer to. */
	citations: Map<string, ContextCitation>;
	/** True when the citations came from a saved message rather than a request. */
	saved: boolean;
	/** The passage this turn was about, when it had one. */
	attachment?: SelectionAttachment | undefined;
	/** The resolved action, used only for candidate semantics. */
	skill?: Skill;
	/** True when the action was one whose reply carries a passage. */
	expectsCandidate: boolean;
	/** True when the replacement continues the passage rather than replacing it. */
	continuation: boolean;
	/** The writer's own state for a candidate, by key. */
	stateFor: (key: string) => CandidateState | undefined;
}

/**
 * Split an answer into what to show.
 *
 * The order of the original is preserved exactly, so an explanation that runs
 * before, between and after two proposed changes reads in that order.
 */
export function presentMessage(options: PresentOptions): MessageBlock[] {
	const { message } = options;
	const blocks: MessageBlock[] = [];

	if (message.role === "assistant" && message.candidate && options.attachment) {
		const replacement = message.candidate.kind === "continue"
			? assembleContinuation(rewritableCore(options.attachment), message.candidate.replacement)
			: message.candidate.replacement;
		if (message.text.trim()) {
			blocks.push({ kind: "prose", segments: segmentsFor(message.text, options) });
		}
		const candidate = buildCandidate(`${message.id}#0`, replacement, null, options);
		if (candidate) blocks.push({ kind: "candidate", key: `${message.id}#0`, candidate });
		return blocks.length > 0 ? blocks : [{ kind: "prose", segments: segmentsFor(message.text, options) }];
	}

	const fences = message.role === "assistant" ? allFences(message.text) : [];

	let cursor = 0;
	let index = 0;
	/** A 原文 block waits for the replacement that follows it. */
	let pendingSource: string | null = null;

	const pushProse = (text: string): void => {
		if (text.trim().length === 0) return;
		blocks.push({ kind: "prose", segments: segmentsFor(text, options) });
	};

	for (const fence of fences) {
		const label = fence.label.trim().toLowerCase();

		if (SOURCE_FENCE_LABELS.includes(label)) {
			pushProse(message.text.slice(cursor, fence.start));
			cursor = fence.end;
			pendingSource = fence.body;
			continue;
		}

		const labelled = CANDIDATE_FENCE_LABELS.includes(label);
		if (!labelled && !(options.expectsCandidate && isBareBlockReply(message.text, fences))) {
			// An unlabelled block in an ordinary answer is an example, not an
			// edit. Leave it exactly where the assistant put it.
			pendingSource = null;
			continue;
		}

		const key = `${message.id}#${index}`;
		const candidate = buildCandidate(key, fence.body, pendingSource, options);
		pendingSource = null;
		if (!candidate) continue;

		pushProse(message.text.slice(cursor, fence.start));
		blocks.push({ kind: "candidate", key, candidate });
		cursor = fence.end;
		index += 1;
	}

	pushProse(message.text.slice(cursor));
	if (blocks.length === 0) blocks.push({ kind: "prose", segments: segmentsFor(message.text, options) });
	return blocks;
}

/** Prose with its references resolved, by whichever scheme applies. */
function segmentsFor(text: string, options: PresentOptions): ProseSegment[] {
	return options.saved
		? splitSavedProse(text, options.citations)
		: splitProseWithCitations(text, options.citations);
}

/**
 * Is the whole reply one unlabelled block, and nothing else?
 *
 * The unlabelled fallback exists for a reply that *is* the passage: a fence
 * around the entire answer can only be the passage, so demanding a label there
 * is ceremony. It stops being safe the moment the reply is a conversation.
 *
 * A writing action that can also talk will illustrate a point with a block —
 * deliberately bad prose, to show what "over-explained" means. Under the old
 * rule that block inherited `expectsCandidate` from the Skill and arrived
 * wearing an 应用 button, one press away from writing the bad example into the
 * manuscript. So once there is prose around it, or more than one block to
 * choose from, the block has to say what it is.
 *
 * The cost is asymmetric and points this way: a model that writes prose and
 * forgets the label costs one re-ask, while the other direction quietly
 * corrupts a manuscript.
 */
function isBareBlockReply(text: string, fences: readonly Fence[]): boolean {
	if (fences.length !== 1) return false;
	const fence = fences[0];
	return `${text.slice(0, fence.start)}${text.slice(fence.end)}`.trim().length === 0;
}

/**
 * Turn one replacement into a reviewable candidate, or decline.
 *
 * Declines when there is no attachment, when the quoted original cannot be
 * located uniquely, and when the replacement would not change anything. Every
 * one of those is a case where showing an 应用 button would be offering to write
 * somewhere nobody has established.
 */
function buildCandidate(
	key: string,
	replacement: string,
	quotedSource: string | null,
	options: PresentOptions,
): RewriteCandidate | null {
	const attachment = options.attachment;
	if (!attachment) return null;
	if (replacement.trim().length === 0) return null;

	let target = attachment;

	if (quotedSource !== null && quotedSource.trim().length > 0) {
		// Read-only context may never create another editable range, so a quote
		// of something outside the captured selection still produces no
		// candidate. A quote of a sentence *inside* it is a different thing: the
		// writer established that territory themselves, and narrowing to it
		// writes nowhere they had not already selected.
		const narrowed = narrowToQuote(attachment, quotedSource);
		if (!narrowed) return null;
		target = narrowed;
	}

	const core = rewritableCore(target);
	if (core.length === 0) return null;

	// Whatever the model did, our reference notation does not go into the
	// manuscript. Instructions ask it to keep markers out of drafted prose;
	// this makes it true.
	const clean = stripCitationMarkers(replacement, options.citations);
	const suggested = options.continuation ? assembleContinuation(core, clean) : clean;

	// What the writer typed wins over what the model proposed. The diff, the
	// apply and the copy all read from the same value, so 差异 always shows what
	// pressing 应用 would actually write.
	const state0 = options.stateFor(key);
	const replacementCore = state0?.editedCore ?? suggested;
	// What the writer would have had to notice themselves. Computed from the
	// model's own words rather than `replacementCore`, which for a continuation
	// already has the passage prepended and would match it wholesale; and from
	// the writer's edit when they have made one, since that is what will be
	// applied. See `findAdjacentRepetition`.
	const repetition = findAdjacentRepetition({
		// `replacementCore` is what pressing 应用 would write, which for a
		// continuation already has the passage in front of it (see
		// `assembleContinuation`). Comparing that against the passage would match
		// it wholesale, so the prefix comes back off first.
		candidate: options.continuation && replacementCore.startsWith(core)
			? replacementCore.slice(core.length)
			: replacementCore,
		selection: core,
		kind: options.continuation ? "continue" : "replace",
		...(target.before !== undefined ? { before: target.before } : {}),
		...(target.after !== undefined ? { after: target.after } : {}),
	});

	const full = assembleReplacement(target, replacementCore);
	if (full === target.text) return null;

	// A salvaged parse may have a preamble in it, so it is marked and the writer
	// is asked before it is applied.
	const unverified = options.message.metadata?.rewriteParse === "fallback";
	const state = state0;
	const anchored = state?.range ? { ...target, from: state.range.from, to: state.range.to } : target;

	const candidate: RewriteCandidate = {
		attachment: anchored,
		instruction: options.message.text,
		replacementCore,
		...(repetition.length > 0 ? { repetition } : {}),
		ops: diffText(anchored.text, assembleReplacement(anchored, replacementCore)),
		// Opens on the prose, not on the markup. A rewrite is read as writing —
		// `差异` answers "what changed", which is the second question. The
		// exception is a salvaged parse: its own warning tells the writer to
		// read the diff first, so that card opens where the warning points.
		mode: state?.mode ?? (unverified ? "diff" : "after"),
		phase: state?.phase ?? "preview",
		...(options.skill ? { skill: options.skill } : {}),
	};
	if (state?.token) candidate.token = state.token;
	if (state?.staleNote) candidate.staleNote = state.staleNote;
	if (unverified) candidate.unverified = true;
	if (state?.editedCore !== undefined && state.editedCore !== suggested) {
		candidate.edited = true;
		candidate.suggestedCore = suggested;
	}
	return candidate;
}

/**
 * The selection, narrowed to the sentence a reply quoted out of it.
 *
 * A reply that discusses a long passage quotes the line it is changing, not
 * the whole thing — and once ordinary conversation was allowed to carry a
 * proposal, that became the common shape: 原文 / 改写后, sometimes several pairs
 * in one answer. Requiring the quote to equal the *entire* selection dropped
 * every one of them, so the writer got a page of suggestions and no way to
 * accept any of it.
 *
 * Narrowing is safe in a way a free-floating quote is not: the range stays
 * inside the passage the writer selected, so applying writes only where they
 * had already pointed. Everything outside the selection remains unreachable.
 *
 * Declines when the quote is absent, and when it occurs more than once — a
 * repeated sentence gives no way to tell which was meant, and guessing would
 * write into the wrong half of the passage.
 */
function narrowToQuote(attachment: SelectionAttachment, quoted: string): SelectionAttachment | null {
	const needle = quoted.trim();
	const haystack = attachment.text;
	if (needle.length === 0) return null;
	if (needle === haystack.trim()) return attachment;

	const at = haystack.indexOf(needle);
	if (at === -1) return null;
	if (haystack.indexOf(needle, at + needle.length) !== -1) return null;

	const from = advancePosition(attachment.from, haystack.slice(0, at));
	const to = advancePosition(from, needle);
	// `before` and `after` are what re-anchoring reads to find the passage
	// again once it has moved, so they must describe the narrowed range: the
	// text on either side of the quote is now part of its surroundings.
	return {
		...attachment,
		from,
		to,
		text: needle,
		charCount: countChars(needle),
		preview: previewOf(needle),
		before: `${attachment.before ?? ""}${haystack.slice(0, at)}`,
		after: `${haystack.slice(at + needle.length)}${attachment.after ?? ""}`,
	};
}
