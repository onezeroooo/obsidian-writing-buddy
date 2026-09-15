import type { ContextDepth, ContextTask, Skill } from "../types";
import { isFullCorpusWritingRequest } from "./FullCorpusContext";
import { contextBudgetFor, type ContextPlan } from "./types";

export interface ContextPlanInput {
	mode?: ContextDepth;
	query: string;
	skill?: Skill;
	selectionChars?: number;
}

/** Build a deterministic local context plan; Runtime V2 never selects files. */
export function planContext(input: ContextPlanInput): ContextPlan {
	const mode = input.mode ?? "auto";
	const task = contextTask(input.skill, input.query, Boolean(input.selectionChars));
	const writingAction = input.skill?.action === "rewrite" || input.skill?.action === "continue" ||
		task === "rewrite" || task === "continue";
	// Context grants authority; it does not guess which project evidence the
	// task needs. In Auto the Agent may synthesize immediately or use tools.
	//
	// Only the writer's Context choice reaches this decision. Whether the
	// Composer was empty when an action was pressed is a UI gesture, not
	// evidence about what the passage needs, and ADR 0001 gives semantic
	// sufficiency to the Agent for the whole of Auto. Reading the gesture here
	// also made the same button behave two ways for reasons the writer could
	// not see: pressing 润色 researched nothing, pressing it with any word typed
	// researched normally.
	const execution = mode === "full"
		? "full-current-manuscript" as const
		: mode === "low"
			? "single-turn" as const
			: mode === "auto" || legacyHighUsesResearch(task, input.query)
				? "bounded-research" as const
				: "single-turn" as const;
	const coverage = execution === "full-current-manuscript" ? "full-current-manuscript" as const : "bounded" as const;
	const resolvedDepth = mode === "auto"
		? "medium" as const
		: mode === "full" ? "high" as const : mode;
	const base = contextBudgetFor(resolvedDepth);
	const selectionChars = input.selectionChars ?? 0;
	const expandedTotal = Math.max(base.totalChars, selectionChars + base.surroundingChars * 2);

	return {
		mode,
		resolvedDepth,
		task,
		execution,
		coverage,
		...(mode === "full" && writingAction
			? { blockingReason: "full-not-supported-for-writing-action" as const }
			: {}),
		// The active editor is the immediate writing state for every task.
		// Cross-file retrieval remains saved Vault content.
		sourceRevision: "editor",
		includeActiveFile: true,
		includeArchives: execution !== "full-current-manuscript" && asksForArchive(input.query),
		preserveActiveFile: task === "chapter-summary",
		budgetExpandedForSelection: expandedTotal > base.totalChars,
		budget: {
			...base,
			totalChars: expandedTotal,
		},
	};
}

export function contextTask(skill: Skill | undefined, query: string, hasSelection: boolean): ContextTask {
	if (skill?.id === "chapter-summary") return "chapter-summary";
	// `consistency` folded in the two review Skills that already planned as an
	// evidence comparison. The retired ids stay listed so a stored turn plans
	// exactly as it did when it ran.
	if (skill?.id === "consistency" || skill?.id === "continuity" ||
		skill?.id === "character-consistency") return "continuity";
	if (skill?.action === "continue") return "continue";
	if (skill?.action === "rewrite") return "rewrite";
	if (isFullCorpusWritingRequest(query)) return asksToContinue(query) ? "continue" : "rewrite";
	if (skill?.id === "foreshadow" || skill?.scope === "project") return "project-review";
	if (/连续|前后|矛盾|伏笔|铺垫|时间线|一致性/.test(query)) return "continuity";
	if (hasSelection || skill?.scope === "selection") return "selection-qa";
	return "qa";
}

export function asksForArchive(query: string): boolean {
	return /旧稿|旧版|修改稿|弃稿|废稿|历史版本|存档|归档版本|冲突副本|(?:比较|对比|比对|对照|参照).{0,20}草稿|草稿.{0,20}(?:比较|对比|比对|对照|参照)|compare.{0,12}(draft|version|archive)|old.{0,8}(draft|version)/i.test(query);
}

/**
 * Preserve High's pre-Phase-A routing without using it to choose any source.
 * Auto does not use this compatibility gate: its Agent always decides whether
 * project research is needed.
 */
function legacyHighUsesResearch(task: ContextTask, query: string): boolean {
	if (task === "rewrite" || task === "continue" || task === "chapter-summary") return false;
	if (task === "continuity" || task === "project-review") return true;
	if (/(?:人物|角色|人设|称谓|身份|指代|代词|指谁|前因|后果|缘由|因果|动机|伏笔|铺垫|呼应|时间线|一致性|矛盾|设定|前后文|上一章|之前发生)/i.test(query)) return true;
	if (/(?:句法|语法|措辞|用词|表达|句式|语态|标点|文风|读起来|顺不顺|不顺|啰嗦)/i.test(query)) return false;
	if (/(?:合理|为什么|为何|何以|原因|导致|怎么会|如何会)/i.test(query)) return true;
	return /(?:跨章|跨章节|其他章节|别的章节|前几章|后几章|前文|后文|全局|正典|canon|人物卡|角色卡|世界观|大纲|资料库|cross[- ]?chapter|other chapters?|earlier chapters?|later chapters?)/iu.test(query);
}

function asksToContinue(query: string): boolean {
	return /(?:续写|接着写|继续写)|\b(?:continue|complete)\b/iu.test(query.normalize("NFKC"));
}
