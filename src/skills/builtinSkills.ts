/**
 * Release-owned task Skills.
 *
 * A Skill answers only "what writing task is this?" Product policy, selection
 * grounding, citations, review behavior, and candidate-output formatting live
 * in `src/instructions/` and are composed for every turn. Keeping those layers
 * out of these bodies prevents a custom Skill from replacing product rules and
 * prevents the same protocol from drifting across every copy.
 */

import { getLocale, instructionLocale } from "../i18n";
import type { Skill, SkillRoutingMetadata } from "../types";

type BuiltinSkill = Omit<Skill, "builtin" | "triggers"> & {
	routing: SkillRoutingMetadata;
};

function builtin(skill: BuiltinSkill): Skill {
	return {
		...skill,
		// Keep legacy Markdown files routable while `triggers` remains their flat
		// on-disk representation. The router prefers structured metadata.
		triggers: [...skill.routing.phrases],
		builtin: true,
	};
}

/**
 * Plain selection Q&A is shared chat behavior, not a task Skill. It therefore
 * has no built-in entry and leaves no artificial `ask-selection` in history.
 */
export const BUILTIN_SKILLS: Skill[] = [
	builtin({
		id: "rewrite",
		name: "改写",
		action: "rewrite",
		scope: "selection",
		version: 4,
		description: "按你的说明改写选区。",
		routing: { phrases: ["改写", "重写", "换个写法", "改一下"] },
		instruction: [
			"按照作者本次给出的具体要求改写当前选区。",
			"保持人物称谓和既有设定不变，除非作者明确要求改动。",
		].join("\n"),
	}),
	builtin({
		id: "polish",
		name: "润色",
		action: "rewrite",
		scope: "selection",
		version: 4,
		description: "保持剧情不变，优化语言与节奏。",
		routing: { phrases: ["润色", "打磨", "改得更好", "语言优化"] },
		instruction: [
			"润色当前选区。",
			"保留剧情、人物行为和信息点不变。",
			"优化语言、节奏、衔接和表达。",
			"不要增加新的情节，也不要删除已有的信息点。",
		].join("\n"),
	}),
	builtin({
		id: "shorten",
		name: "精简",
		action: "rewrite",
		scope: "selection",
		version: 4,
		description: "压缩篇幅，保留全部信息点。",
		routing: { phrases: ["精简", "压缩", "收紧", "太啰嗦", "删减", "短一点"] },
		instruction: [
			"精简当前选区。",
			"在明显缩短篇幅的同时保留全部关键信息点和人物行为。",
			"优先删去重复描写、冗余修饰和不承担作用的过渡句。",
		].join("\n"),
	}),
	builtin({
		id: "expand",
		name: "扩写",
		action: "rewrite",
		scope: "selection",
		version: 4,
		description: "在既有情节内补充细节。",
		routing: { phrases: ["扩写", "展开", "写细一点", "太简略", "补充细节"] },
		instruction: [
			"扩写当前选区。",
			"在不改变既有情节走向的前提下补充细节、感官描写和人物反应。",
			"不要引入新的人物、地点或设定。",
		].join("\n"),
	}),
	builtin({
		id: "continue",
		name: "续写",
		action: "continue",
		scope: "selection",
		version: 4,
		description: "顺着当前段落往下写。",
		routing: { phrases: ["续写", "接着写", "往下写", "接下去", "后面加", "再加点", "补点", "加点对话"] },
		instruction: [
			"顺着当前选区继续往下写。",
			"保持叙述人称、时态、语气和节奏与前文一致。",
			"新内容要能直接接在当前选区之后。",
		].join("\n"),
	}),
	builtin({
		id: "scene-polish",
		name: "场景打磨",
		action: "rewrite",
		scope: "selection",
		version: 1,
		description: "针对这个场景真正的问题下手：动作、对白、衔接或叙事流畅度。",
		routing: {
			phrases: [
				"场景打磨", "打磨场景", "打磨这段",
				"少解释", "改成动作", "别写心理", "太直白", "show not tell",
				"对白打磨", "打磨对白", "对白不像", "台词生硬", "说话不像", "对白改一改",
				"衔接", "过渡", "太跳", "接不上", "转场",
			],
		},
		instruction: [
			"对当前选区做局部打磨。可处理的方面包括：情绪与心理的直白说明改由动作、细节、环境或留白承担；对白的语气、辨识度和信息负担；段落与场景之间的衔接；以及局部叙事的流畅度。",
			"先判断这次真正需要处理什么，再动手。依据是作者本次提出的要求、当前选区的实际问题，以及已有上下文。作者点明了方向就按他说的做；没点明就只处理选区里确实成立的问题。",
			"不要每次都把上述方面全改一遍，也不要为了显得做了事而改动本来就成立的地方。这一段只有对白的问题，就只动对白。",
			"保留全部情节和信息点，不要引入新的人物、地点、设定或事件，不要改变人物已经做出的行为。",
		].join("\n"),
	}),
	builtin({
		id: "pacing",
		name: "节奏诊断",
		action: "chat",
		scope: "selection",
		version: 2,
		description: "指出哪里太快、哪里拖，以及可以怎么调。",
		instructionProfile: "review",
		routing: { phrases: ["节奏诊断", "节奏太慢", "节奏太快", "哪里太拖", "读着累"], allowQuestions: true },
		instruction: [
			"诊断当前选区的节奏。",
			"指出哪些地方推进过快、读者来不及跟上，哪些地方停留过久、张力松掉。",
			"结合前后文判断，而不是只看句子长短。",
			"给出具体位置和调整方向。",
		].join("\n"),
	}),
	builtin({
		id: "consistency",
		name: "一致性检查",
		action: "chat",
		scope: "project",
		version: 2,
		description: "对照既有设定和前后文，找出对不上的地方。",
		instructionProfile: "review",
		routing: {
			phrases: [
				"一致性检查", "一致性", "前后矛盾", "前后文对照", "细节矛盾", "连贯性", "时间线",
				"人物一致", "性格不对", "和人设冲突", "人设对不上",
				"伏笔检查", "伏笔回收", "线索回收", "有没有铺垫", "挖的坑",
			],
			allowQuestions: true,
		},
		instruction: [
			"这是一个证据比较型任务：结论来自两处以上材料的对照，而不是对单独一段的印象。",
			"选区或当前段落通常只是被检查的对象，不是完整的证据集。判断它与别处是否冲突，需要先掌握别处写了什么。若本次的 Context 模式允许项目研究，就根据作者的问题主动检索并阅读所需的项目材料，再下判断。",
				"若任务的正确性取决于逐一覆盖所有正文单元，并且本次工具协议提供完整覆盖能力，应请求该能力；若只需相关证据即可回答，则使用普通项目研究。是否需要完整覆盖由任务语义决定，不按关键词套规则。",
			"可以关注的方面包括：人物言行是否与既有人设或前文冲突；世界观与设定是否冲突；时间线是否连贯；事件顺序；物件状态；人物状态；前后章节的细节是否对应；埋下的伏笔是否有回收；回收是否与原伏笔矛盾；遗忘、错接、重复；以及明显的逻辑断裂。",
			"这不是一张必须逐项填写的清单。根据作者的问题和实际读到的材料判断哪些方面相关，只报告确实找到证据的冲突，并写清楚此处与彼处分别写了什么。没有发现问题就直说，不要为了凑数把存疑的写成冲突。",
			"如果本次实际可用的材料不足以支撑项目级或全文的一致性判断，就说明这次检查覆盖到哪里为止，不要把局部检查说成已完成全文核对。",
		].join("\n"),
	}),
];

/**
 * English faces for the built-in skills.
 *
 * `BUILTIN_SKILLS` above stays the canonical set: identity, versioning,
 * migration fingerprints and customization base hashes are all computed from
 * it, in Chinese, regardless of language. What the writer sees and what the
 * model is instructed with may differ — `localizeBuiltinSkill` overlays these
 * fields when the project's instruction language is English, and routing keeps
 * the union of both phrase sets so a writer typing either language still lands
 * on the skill.
 */
interface BuiltinSkillFace {
	name: string;
	description: string;
	phrases: readonly string[];
	instruction: string;
}

const EN_BUILTIN_FACES: Readonly<Record<string, BuiltinSkillFace>> = {
	rewrite: {
		name: "Rewrite",
		description: "Rewrite the selection to your instructions.",
		phrases: ["rewrite", "rework", "rephrase", "redo this"],
		instruction: [
			"Rewrite the current selection according to the author's specific request this turn.",
			"Keep character names, forms of address, and established canon unchanged unless the author explicitly asks.",
		].join("\n"),
	},
	polish: {
		name: "Polish",
		description: "Improve the prose while keeping the story unchanged.",
		phrases: ["polish", "smooth this out", "improve the prose", "make it read better"],
		instruction: [
			"Polish the current selection.",
			"Keep the plot, character behavior, and information content unchanged.",
			"Improve wording, rhythm, transitions, and expression.",
			"Do not add new plot, and do not drop existing information.",
		].join("\n"),
	},
	shorten: {
		name: "Tighten",
		description: "Cut length while keeping every information point.",
		phrases: ["tighten", "shorten", "condense", "too wordy", "trim this", "cut this down"],
		instruction: [
			"Tighten the current selection.",
			"Shorten it noticeably while keeping every key information point and character action.",
			"Cut repeated description, redundant modifiers, and transitions that do no work first.",
		].join("\n"),
	},
	expand: {
		name: "Expand",
		description: "Add detail within the existing plot.",
		phrases: ["expand", "develop this", "more detail", "too thin", "flesh out"],
		instruction: [
			"Expand the current selection.",
			"Add detail, sensory description, and character reactions without changing where the existing plot goes.",
			"Do not introduce new characters, places, or canon.",
		].join("\n"),
	},
	continue: {
		name: "Continue",
		description: "Keep writing from where the passage ends.",
		phrases: ["continue", "keep writing", "keep going", "write more", "add more", "what comes next"],
		instruction: [
			"Continue writing from the current selection.",
			"Keep the narrative person, tense, tone, and rhythm consistent with what precedes.",
			"The new text must connect directly after the current selection.",
		].join("\n"),
	},
	"scene-polish": {
		name: "Scene polish",
		description: "Work on what this scene actually needs: action, dialogue, joins, or flow.",
		phrases: [
			"scene polish", "polish this scene",
			"show not tell", "less explaining", "too on the nose",
			"dialogue polish", "stilted dialogue", "doesn't sound like them",
			"transition", "jumps too fast", "doesn't connect",
		],
		instruction: [
			"Do targeted polishing on the current selection. Aspects it may cover: flat statements of emotion or psychology handed over to action, detail, environment, or restraint; the voice, distinctiveness, and information load of dialogue; the joins between paragraphs and scenes; and local narrative flow.",
			"Judge what this pass actually needs before touching anything, from the author's request this turn, the real problems in the selection, and the surrounding context. If the author named a direction, follow it; if not, address only problems that genuinely exist in the selection.",
			"Do not work through every aspect every time, and do not change what already works just to look busy. If only the dialogue is off, change only the dialogue.",
			"Keep all plot and information points; do not introduce new characters, places, canon, or events, and do not change what characters have already done.",
		].join("\n"),
	},
	pacing: {
		name: "Pacing check",
		description: "Point out where it rushes, where it drags, and how to adjust.",
		phrases: ["pacing", "pacing check", "too slow", "too rushed", "where does it drag", "tiring to read"],
		instruction: [
			"Diagnose the pacing of the current selection.",
			"Point out where it moves too fast for the reader to keep up, and where it lingers so long the tension slackens.",
			"Judge against the surrounding context, not sentence length alone.",
			"Give specific locations and directions for adjustment.",
		].join("\n"),
	},
	consistency: {
		name: "Consistency check",
		description: "Check against existing canon and the surrounding text for mismatches.",
		phrases: [
			"consistency", "consistency check", "contradiction", "contradicts",
			"timeline", "out of character", "against the character sheet",
			"foreshadowing", "payoff", "plot hole", "setup check",
		],
		instruction: [
			"This is an evidence-comparison task: conclusions come from setting two or more places side by side, not from an impression of a single passage.",
			"The selection or current paragraph is usually the thing being checked, not the complete evidence set. Judging whether it conflicts with elsewhere requires knowing what elsewhere says. If this turn's Context mode allows project research, retrieve and read the material the author's question needs before judging.",
			"If correctness depends on covering every unit of the text one by one, and this turn's tool protocol offers full coverage, request that capability; if relevant evidence is enough to answer, use ordinary project research. Whether full coverage is needed follows from the task's meaning, not keyword rules.",
			"Aspects worth attention include: words and actions conflicting with established characterization or earlier text; conflicts with worldbuilding or canon; timeline coherence; event order; the state of objects; the state of characters; whether details correspond across chapters; whether planted foreshadowing is paid off; whether the payoff contradicts the setup; forgetting, mis-joins, repetition; and outright logical breaks.",
			"This is not a checklist to fill in item by item. Judge which aspects are relevant from the author's question and what the material actually says, report only conflicts backed by real evidence, and state clearly what this place and that place each say. If nothing is wrong, say so plainly; do not upgrade doubts into conflicts to pad the list.",
			"If the material actually available this turn cannot support a project-level or whole-text consistency judgment, say how far this check reached; do not present a local check as a completed full-text verification.",
		].join("\n"),
	},
};

/**
 * The skill as served under the current languages.
 *
 * Identity fields — id, version, action, scope, profiles — never change. The
 * name and description the writer reads follow the interface language; the
 * instruction the model receives follows the instruction language; under
 * English instructions the routing phrases become the union of both languages
 * so neither writer loses a trigger. Hashes must be computed from the
 * canonical skill, never from the localized copy.
 */
export function localizeBuiltinSkill(skill: Skill): Skill {
	const face = EN_BUILTIN_FACES[skill.id];
	if (!face) return skill;
	const englishFace = getLocale() === "en";
	const englishInstruction = instructionLocale() === "en";
	if (!englishFace && !englishInstruction) return skill;
	const phrases = englishInstruction ? [...face.phrases, ...(skill.routing?.phrases ?? [])] : [...(skill.routing?.phrases ?? skill.triggers ?? [])];
	return {
		...skill,
		...(englishFace ? { name: face.name, description: face.description } : {}),
		...(englishInstruction ? { instruction: face.instruction } : {}),
		triggers: [...phrases],
		routing: skill.routing ? { ...skill.routing, phrases } : { phrases },
	};
}

/** The rewrite task used when a writer explicitly asks for a generic rewrite. */
export const DEFAULT_REWRITE_SKILL_ID = "rewrite";

export function findBuiltinSkill(id: string): Skill | undefined {
	return BUILTIN_SKILLS.find((skill) => skill.id === id);
}

/**
 * Built-in ids that shipped in earlier releases and no longer have an entry.
 *
 * Three scene-level rewrites and three review Skills were folded into
 * `scene-polish` and `consistency`; `chapter-summary` was retired outright
 * because plain summarising is ordinary chat, not a task Skill. Persisted
 * turns, sessions and composer state still name the old ids, so resolution
 * maps them to what replaced them rather than rewriting stored history.
 *
 * A retired id is no longer reserved: a writer may define a custom Skill with
 * that id. Lookup therefore consults real Skills first and only falls back
 * here, so an alias can never shadow or rename a writer's own file.
 */
export const RETIRED_BUILTIN_SKILL_IDS: ReadonlyMap<string, string> = new Map([
	["show-not-tell", "scene-polish"],
	["dialogue", "scene-polish"],
	["transition", "scene-polish"],
	["character-consistency", "consistency"],
	["continuity", "consistency"],
	["foreshadow", "consistency"],
	// `chapter-summary` intentionally has no successor. It degrades to no
	// selected Skill, which is generic chat — the behaviour it is replaced by.
]);

/** The current id that supersedes a retired built-in id, when one does. */
export function resolveRetiredBuiltinSkillId(id: string): string | undefined {
	return RETIRED_BUILTIN_SKILL_IDS.get(id);
}
