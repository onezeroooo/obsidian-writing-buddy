/**
 * The immutable boundary between Composer preflight and turn execution.
 *
 * Routing, context planning, transcript selection and instruction composition
 * all depend on mutable UI/project state. They are resolved exactly once,
 * before the visible user message is persisted, then this snapshot is passed
 * unchanged to the selected controller.
 */

import type { RequestMessage, SkillPayload } from "../backend/AIBackend";
import type { ContextPlan } from "../context/types";
import type {
	ContextBuildReport,
	ConversationHistoryReport,
	InstructionCompositionReport,
	ResearchContextReport,
} from "../types";
import type { EffectiveInstructions } from "../instructions";
import type { ProjectInstructionsStatus } from "../instructions/ProjectInstructions";
import type {
	ConversationHistorySelection,
} from "./conversationHistory";
import type { SkillRouteResult } from "./skillRouting";
import type { HistoricalSelectionMatch } from "./messageText";
import type { SelectionAttachment, SessionPreferences, Skill } from "../types";

export const POLICY_SKILL_ID = "writing-buddy-policy";
export const POLICY_SKILL_NAME = "WritingBuddy Product Policy";

/** Compatibility names for consumers of the turn-planning module. */
export type TurnHistoryReport = ConversationHistoryReport;
export type TurnInstructionReport = InstructionCompositionReport;

export interface TurnExecutionReports {
	history: TurnHistoryReport;
	instructions: TurnInstructionReport;
	research?: ResearchContextReport;
}

export interface TurnPlan {
	currentMessageId: string;
	question: string;
	sessionId: string;
	firstTurn: boolean;
	preferences: Readonly<SessionPreferences>;
	currentFile?: string;
	selection?: SelectionAttachment;
	/** Full prior selection snapshots explicitly requested by this turn. */
	historicalSelections: readonly HistoricalSelectionMatch[];
	route: SkillRouteResult;
	skill?: Skill;
	/**
	 * Answer this turn conversationally rather than as a bare passage.
	 *
	 * True whenever the writer typed something. An empty Composer means they
	 * pressed the action and are waiting for a candidate, which is what the
	 * candidate-returning transport is for and what it is fastest at. Typing a
	 * sentence is the opposite signal: they are already talking, and a reply
	 * that may decline to propose anything is worth more than one forced to
	 * produce a passage.
	 *
	 * Both shapes let the model say what it judged before writing. That is a
	 * property of the output contract, not of this flag, and it must not depend
	 * on whether the Composer happened to be empty.
	 *
	 * It is the writer's own gesture rather than a guess about their sentence.
	 * Inferring it from phrasing would be the Skill router's problem again, and
	 * a rule the writer cannot predict is worse than one they perform.
	 */
	conversational: boolean;
	context: ContextPlan;
	history: ConversationHistorySelection;
	instructions: EffectiveInstructions;
	instructionPayload: SkillPayload;
	projectInstructionsStatus: ProjectInstructionsStatus;
}

/** Build the one Runtime instruction carrier, including for no-Skill chat. */
export function buildInstructionPayload(
	instructions: EffectiveInstructions,
	skill?: Skill,
): SkillPayload {
	const text = instructions.text.trim();
	if (!text) throw new Error("WritingBuddy instructions are empty.");
	return Object.freeze({
		id: skill?.id ?? POLICY_SKILL_ID,
		name: skill?.name ?? POLICY_SKILL_NAME,
		action: skill?.action ?? "chat",
		instructions: text,
	});
}

/** Snapshot a registry Skill, including its routing and revision metadata. */
export function snapshotSkill<T extends Skill>(skill: T): T {
	return Object.freeze({
		...skill,
		...(skill.triggers ? { triggers: Object.freeze([...skill.triggers]) } : {}),
		...(skill.routing
			? { routing: Object.freeze({ ...skill.routing, phrases: Object.freeze([...skill.routing.phrases]) }) }
			: {}),
	});
}

/** Deep-freeze the mutable pieces that execution is allowed to consume. */
export function freezeTurnPlan(input: TurnPlan): Readonly<TurnPlan> {
	const selection = input.selection ? freezeSelection(input.selection) : undefined;
	const messages = freezeMessages(input.history.messages);
	const historyMessages = freezeMessages(input.history.history);
	const history = Object.freeze({
		...input.history,
		messages,
		history: historyMessages,
	}) as ConversationHistorySelection;
	const context = Object.freeze({
		...input.context,
		budget: Object.freeze({ ...input.context.budget }),
	});
	const historicalSelections = Object.freeze(input.historicalSelections.map((match) => Object.freeze({
		...match,
		selection: freezeSelection(match.selection),
	})));

	return Object.freeze({
		...input,
		preferences: Object.freeze({ ...input.preferences }),
		...(selection ? { selection } : {}),
		historicalSelections,
		context,
		history,
		instructionPayload: Object.freeze({ ...input.instructionPayload }),
	});
}

export function turnHistoryReport(history: ConversationHistorySelection): TurnHistoryReport {
	return {
		consideredPairs: history.consideredPairs,
		selectedPairs: history.selectedPairs,
		droppedPairs: history.droppedPairs,
		messageCount: history.historyMessageCount,
		characters: history.historyCharacters,
		estimatedTokens: history.estimatedHistoryTokens,
		truncated: history.truncated,
	};
}

export function turnInstructionReport(turn: Pick<TurnPlan, "instructions" | "projectInstructionsStatus" | "skill">): TurnInstructionReport {
	return {
		layerCount: turn.instructions.layers.length,
		characters: Array.from(turn.instructions.text).length,
		projectStatus: turn.projectInstructionsStatus,
		projectIncluded: turn.instructions.layers.some((layer) => layer.id === "project-customization"),
		skillIncluded: Boolean(turn.skill),
	};
}

/** Attach only counters/status to an existing persisted context report. */
export function withTurnExecutionReports(
	report: ContextBuildReport,
	turn: Pick<TurnPlan, "history" | "instructions" | "projectInstructionsStatus" | "skill">,
	research?: ResearchContextReport,
): ContextBuildReport {
	return {
		...report,
		history: turnHistoryReport(turn.history),
		instructions: turnInstructionReport(turn),
		...(research ? { research } : {}),
	};
}

function freezeMessages(messages: readonly RequestMessage[]): RequestMessage[] {
	return Object.freeze(messages.map((message) => Object.freeze({ ...message }))) as unknown as RequestMessage[];
}

function freezeSelection(selection: SelectionAttachment): SelectionAttachment {
	return Object.freeze({
		...selection,
		from: Object.freeze({ ...selection.from }),
		to: Object.freeze({ ...selection.to }),
	});
}
