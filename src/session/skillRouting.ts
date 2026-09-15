/** Deterministic, inspectable routing for writing tasks. */

import type { Skill } from "../types";

/** True when the action cannot run without a passage to work on. */
/**
 * What a turn says when an action was pressed and nothing was typed.
 *
 * Pressing 润色 with an empty box is a complete request: the Skill already
 * carries the instructions, and the passage is attached. What it lacks is
 * something for the transcript to show and for the model to receive as the
 * writer's turn — an empty user message is not a request, it is a gap.
 *
 * The Skill's name and nothing more. A fuller sentence would be the prefill
 * again, only now written into history where the writer cannot edit it first.
 */
export function impliedQuestionFor(skill: Skill): string {
	return skill.name;
}

export function needsSelection(skill: Skill): boolean {
	if (skill.action !== "chat") return true;
	return skill.scope === "selection";
}

/** True when this action's reply should carry a candidate passage. */
export function producesCandidate(skill: Skill | undefined): boolean {
	return skill?.action === "rewrite" || skill?.action === "continue";
}

/**
 * True when this turn belongs on the rewrite endpoint.
 *
 * `/v2/rewrite` is defined as "given a selection, return a **replacement**"
 * (`REMOTE_AI_PROTOCOL.md`), and that framing reaches the model above anything
 * this client composes. A continuation asks for the opposite — text to follow
 * the selection, leaving it untouched — so sending one there says replace this
 * and then, a layer lower, do not replace this.
 *
 * Measured, not assumed. The same passages, prompt and model through the two
 * endpoints: on `/v2/rewrite` all four continuations restated the selection in
 * new words; on `/v2/chat` three of four carried no repetition at all and the
 * fourth shared only a place name. The instruction was never the problem, and
 * the version of it that says 不要重复或改写已有正文 was already there.
 *
 * D-030 recorded the same shape one level down: a caution plus a layer
 * declaring it inapplicable, where the model obeyed the caution. The lesson
 * was that not sending the contradiction beats sending it and retracting it.
 * Here the contradiction is the endpoint, so the fix is to pick the other one.
 */
export function replacesSelection(skill: Skill | undefined): boolean {
	return producesCandidate(skill) && !isContinuation(skill);
}

/** True when the candidate is inserted after, rather than over, the selection. */
export function isContinuation(skill: Skill | undefined): boolean {
	return skill?.action === "continue";
}

export type SkillRouteSource = "explicit" | "inferred" | "none";
export type SkillRouteReason =
	| "explicit-action"
	| "explicit-action-needs-selection"
	| "strong-intent"
	| "rewrite-followup"
	| "empty-message"
	| "no-skill-intent"
	| "ambiguous-intent";

export type SkillRouteCandidateStatus = "eligible" | "rejected-no-selection" | "rejected-question" | "rejected-negated";

/** A matched phrase and the deterministic decision made from it. */
export interface SkillRouteCandidate {
	skill: Skill;
	phrase: string;
	score: number;
	status: SkillRouteCandidateStatus;
}

/** Routing output that can be logged or asserted without re-running heuristics. */
export interface SkillRouteResult {
	skill?: Skill;
	source: SkillRouteSource;
	reason: SkillRouteReason;
	matchedPhrase?: string;
	candidates: readonly SkillRouteCandidate[];
}

export interface RouteSkillOptions {
	message: string;
	hasSelection: boolean;
	/** A quick action explicitly chosen by the writer. */
	selectedSkill?: Skill;
	/** All available built-in and user-authored Skills, in stable display order. */
	skills?: readonly Skill[];
	/** Optional carry-over for short, unambiguously imperative follow-ups. */
	previousWritingSkill?: Skill;
}

// Each heuristic carries both languages. A message is written in whichever
// language the writer typed, regardless of settings, so the patterns are not
// gated by locale: a phrase can only match a skill that declares it, and the
// intent checks below merely confirm how the matched sentence is meant.
const QUESTION_OPENERS = /^(?:为什么|为何|怎么理解|如何理解|什么意思|是否|是不是|能否|可否|有没有|哪里|哪儿|何时|谁|什么|请问)|^(?:why|how come|what|when|where|who|whose|which|is it|does|do you|should)\b/i;
const QUESTION_ENDING = /[？?]\s*$/;
const EXPLANATION_INTENT = /(?:解释|说明|分析|评价|判断|原因|理由|意味着|意思|\bexplain\b|\bwhy\b|\breason\b|\bmean(?:ing|s)?\b|\banaly[sz]e\b)/i;
const NEGATED_EDIT = /(?:不要|别|无需|不用|不必|先别|不要再|don'?t|do not|no need to|stop|never)\s*(?:帮我|给我|把|再|进行|做)?\s*(?:改写|重写|修改|润色|精简|压缩|扩写|续写|接着写|往下写|改成|打磨|删减|调整|rewrite|rework|rephrase|polish|tighten|shorten|condense|trim|expand|continue|change)/i;
const EDIT_REASON_QUESTION = /(?:为什么|为何|原因|理由)[^。！？?!]{0,24}(?:改写|重写|修改|润色|精简|压缩|扩写|续写|改成|打磨|删减|调整)|\b(?:why|what(?:'s| is) the reason)\b[^.。！？?!]{0,40}\b(?:rewrite|rewrote|rework|change[ds]?|polish)/i;
const IMPERATIVE_PREFIX = /^(?:请|请你|请帮我|帮我|帮忙|麻烦|给我|替我|把|将|再|继续|直接|现在|立刻|务必|试着|尝试|可以帮我|能不能帮我|请不要|不要|别|please\b|pls\b|kindly\b|just\b|go ahead\b|help me\b|can you\b|could you\b|would you\b|will you\b|let'?s\b|try\b)/i;
const EXPLICIT_EDIT_VERB = /(?:改写|重写|修改|润色|精简|压缩|收紧|删减|扩写|续写|接着写|往下写|换个写法|改成动作|打磨对白|对白打磨|处理衔接|调整节奏|\brewrite\b|\brework\b|\brephrase\b|\bpolish\b|\btighten\b|\bshorten\b|\bcondense\b|\btrim\b|\bexpand\b|\bflesh out\b|\bkeep writing\b|\bsmooth\b)/i;
const EXPLICIT_REVIEW_VERB = /(?:检查|诊断|对照|总结|概括|梗概|分析|找出|看看|评估|审查|盘点|\bcheck\b|\bdiagnose\b|\breview\b|\banaly[sz]e\b|\bsummari[sz]e\b|\bfind\b|\blook for\b|\bassess\b|\bevaluate\b|\bexamine\b)/i;
const REQUEST_SUFFIX = /(?:一下|一点|一遍|一版|一些|吧|好吗|可以吗|行吗|给我|看看|,?\s*please|,?\s*thanks|,?\s*thank you|\bfor me)[。！!？?.]?\s*$/i;

/**
 * Route one typed turn. Precedence is deliberately small and visible:
 * explicit action > strong deterministic intent > no Skill.
 *
 * Matching a word is not enough. In particular, questions *about* rewriting
 * and explicit negations remain ordinary chat even if they contain "改写".
 */
export function routeSkill(options: RouteSkillOptions): SkillRouteResult {
	if (options.selectedSkill) {
		if (options.selectedSkill.scope === "selection" && !options.hasSelection) {
			return freezeResult({
				source: "none",
				reason: "explicit-action-needs-selection",
				candidates: [{
					skill: options.selectedSkill,
					phrase: options.selectedSkill.name,
					score: Array.from(options.selectedSkill.name).length,
					status: "rejected-no-selection",
				}],
			});
		}
		return freezeResult({
			skill: options.selectedSkill,
			source: "explicit",
			reason: "explicit-action",
			candidates: [],
		});
	}

	const message = normalizeMessage(options.message);
	if (!message) {
		return freezeResult({ source: "none", reason: "empty-message", candidates: [] });
	}

	const candidates = collectCandidates(message, options.skills ?? [], options.hasSelection);
	const eligible = candidates.filter((candidate) => candidate.status === "eligible");
	if (eligible.length > 0) {
		const winner = eligible[0];
		return freezeResult({
			skill: winner.skill,
			source: "inferred",
			reason: "strong-intent",
			matchedPhrase: winner.phrase,
			candidates,
		});
	}

	const followup = rewriteFollowupSkill(message, options.previousWritingSkill);
	if (followup) {
		return freezeResult({
			skill: followup,
			source: "inferred",
			reason: "rewrite-followup",
			candidates,
		});
	}

	return freezeResult({
		source: "none",
		reason: candidates.length > 0 ? "ambiguous-intent" : "no-skill-intent",
		candidates,
	});
}

function collectCandidates(message: string, skills: readonly Skill[], hasSelection: boolean): SkillRouteCandidate[] {
	const candidates: Array<SkillRouteCandidate & { order: number }> = [];
	for (const [order, skill] of skills.entries()) {
		const match = bestPhraseMatch(message, phrasesFor(skill));
		if (!match) continue;
		let status: SkillRouteCandidateStatus = "eligible";
		if (skill.scope === "selection" && !hasSelection) {
			status = "rejected-no-selection";
		} else if (isNegatedSkillRequest(message, match.phrase)) {
			status = "rejected-negated";
		} else if (!hasStrongIntent(message, skill, match.phrase)) {
			status = "rejected-question";
		}
		candidates.push({ skill, phrase: match.phrase, score: match.score, status, order });
	}

	return candidates
		.sort((left, right) => right.score - left.score || left.order - right.order)
		.map(({ order: _order, ...candidate }) => candidate);
}

function bestPhraseMatch(message: string, phrases: readonly string[]): { phrase: string; score: number } | undefined {
	let best: { phrase: string; score: number } | undefined;
	for (const rawPhrase of phrases) {
		const phrase = normalizeMessage(rawPhrase);
		if (!phrase || !containsPhrase(message, phrase)) continue;
		const score = Array.from(phrase).length;
		if (!best || score > best.score) best = { phrase: rawPhrase.trim(), score };
	}
	return best;
}

function phrasesFor(skill: Skill): string[] {
	const declared = [...(skill.routing?.phrases ?? []), ...(skill.triggers ?? [])];
	return unique([...declared, skill.name]).filter((phrase) => Array.from(phrase.trim()).length >= 2);
}

function hasStrongIntent(message: string, skill: Skill, matchedPhrase: string): boolean {
	if (skill.action === "chat") {
		return skill.routing?.allowQuestions === true
			|| IMPERATIVE_PREFIX.test(message)
			|| EXPLICIT_REVIEW_VERB.test(message)
			|| REQUEST_SUFFIX.test(message);
	}
	if (isNegatedSkillRequest(message, matchedPhrase)) return false;
	if (isQuestionAboutEdit(message)) return false;
	return IMPERATIVE_PREFIX.test(message)
		|| EXPLICIT_EDIT_VERB.test(message)
		|| REQUEST_SUFFIX.test(message)
		// A message that *opens* with the trigger phrase is verb-initial — the
		// ordinary shape of an imperative in either language ("润色一下这段",
		// "polish the last paragraph") — unless it reads as a question.
		|| (normalizeMessage(message).startsWith(normalizeMessage(matchedPhrase)) && !QUESTION_ENDING.test(message))
		|| normalizeMessage(message) === normalizeMessage(matchedPhrase);
}

/**
 * Detect a negator that governs the matched routing phrase itself.
 *
 * This is intentionally task-agnostic: user-created Skills cannot be reduced
 * to WritingBuddy's built-in edit-verb list, and chat Skills such as continuity
 * checks can be negated too. Clause punctuation is a hard boundary, preventing
 * "不要着急，请检查…" from cancelling the later positive request.
 */
function isNegatedSkillRequest(message: string, matchedPhrase: string): boolean {
	const phrase = normalizeMessage(matchedPhrase);
	const phraseIndex = message.indexOf(phrase);
	if (phraseIndex < 0) return false;
	const clausePrefix = message.slice(0, phraseIndex).split(/[，,。！？?!；;：:]/u).at(-1) ?? "";
	return /(?:不要|别|无需|不用|不必|先别|不要再|don'?t|do not|no need to|stop|never)[^，,。！？?!；;：:]{0,24}$/iu.test(clausePrefix);
}

function isNegatedEditRequest(message: string, matchedPhrase: string): boolean {
	return NEGATED_EDIT.test(message) || isNegatedSkillRequest(message, matchedPhrase);
}

function isQuestionAboutEdit(message: string): boolean {
	if (EDIT_REASON_QUESTION.test(message)) return true;
	const question = QUESTION_OPENERS.test(message) || QUESTION_ENDING.test(message);
	return question && EXPLANATION_INTENT.test(message) && !IMPERATIVE_PREFIX.test(message);
}

function containsPhrase(message: string, phrase: string): boolean {
	if (/^[a-z0-9][a-z0-9 -]*$/i.test(phrase)) {
		const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
		return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(message);
	}
	return message.includes(phrase);
}

function normalizeMessage(value: string): string {
	return value.trim().toLowerCase().replace(/[\u3000\t\r\n]+/g, String.fromCharCode(32));
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function freezeResult(result: Omit<SkillRouteResult, "candidates"> & { candidates: SkillRouteCandidate[] }): SkillRouteResult {
	return Object.freeze({ ...result, candidates: Object.freeze(result.candidates.map((candidate) => Object.freeze(candidate))) });
}

/** Preserve an established writing task only for a short imperative follow-up. */
export function rewriteFollowupSkill(message: string, previous: Skill | undefined): Skill | undefined {
	if (!previous || !producesCandidate(previous)) return undefined;
	const text = normalizeMessage(message);
	if (!text || isNegatedEditRequest(text, "改写") || isQuestionAboutEdit(text)) return undefined;
	return /^(?:再|还是|只|就|换|改|这里|这段|这一段|这句|语气|感觉)[\s\S]{0,30}(?:一点|一些|一版|一种|一下|轻|重|短|长|克制|直接|含蓄|自然|改|写|版本|方式)?[。！!？?]?$/.test(text)
		? previous
		: undefined;
}
