import type { Skill } from "../types";
import { productPolicy } from "./productPolicy";
import {
	pressedWritingActionInstruction,
	sharedCandidateProposalInstruction,
	sharedCapabilityInstruction,
	sharedCitationInstruction,
	sharedContinueOutputInstruction,
	sharedReviewInstruction,
	sharedRewriteOutputInstruction,
	sharedSelectionInstruction,
	sharedWritingInstruction,
} from "./sharedInstructions";

export type InstructionLayerId =
	| "product-policy"
	| "shared-selection"
	| "shared-citation"
	| "shared-writing"
	| "shared-review"
	| "shared-output"
	| "shared-proposal"
	| "shared-capabilities"
	| "project-customization"
	| "shared-pressed-action"
	| "task-skill";

export type InstructionLayerOwner = "product" | "shared" | "project" | "skill";

/** One inspectable contribution to the final prompt, in effective order. */
export interface EffectiveInstructionLayer {
	id: InstructionLayerId;
	owner: InstructionLayerOwner;
	text: string;
	/** Product/shared layers ship with the plugin and are never Vault-editable. */
	immutable: boolean;
}

export interface ComposeEffectiveInstructionsOptions {
	skill?: Skill;
	hasSelection: boolean;
	/**
	 * This turn is answered conversationally rather than as a bare passage.
	 *
	 * The candidate-returning transport's whole reply is the passage, so it has
	 * nowhere to put a sentence and normalises one away. A conversational turn
	 * is the opposite: prose is the reply, and a passage inside it must declare
	 * itself with a label before it can be applied.
	 */
	conversational?: boolean;
	/**
	 * The writer pressed the action's button rather than typing something the
	 * router recognised.
	 *
	 * The distinction is not cosmetic: pressing is an unambiguous instruction to
	 * change the attached passage, and the conversational stack otherwise carries
	 * two cautions that assume the opposite. Omitted means false, which leaves
	 * every caller that cannot know on the cautious side.
	 */
	pressed?: boolean;
	/** Optional writer-owned project guidance. Blank content is ignored. */
	projectCustomization?: string;
}

export interface EffectiveInstructions {
	text: string;
	layers: readonly EffectiveInstructionLayer[];
}

/**
 * Compose the policy stack independently from context retrieval and Skill
 * routing. A plain chat therefore still receives product/citation/selection
 * behavior while retaining `skill: undefined` in conversation history.
 */
export function composeEffectiveInstructions(
	options: ComposeEffectiveInstructionsOptions,
): EffectiveInstructions {
	const layers: EffectiveInstructionLayer[] = [];
	addLayer(layers, "product-policy", "product", productPolicy(), true);

	if (options.hasSelection) {
		addLayer(layers, "shared-selection", "shared", sharedSelectionInstruction(), true);
	}

	const action = options.skill?.action ?? "chat";
	const review = options.skill?.instructionProfile === "review";
	if (action === "rewrite" || action === "continue") {
		addLayer(layers, "shared-writing", "shared", sharedWritingInstruction(), true);
		const outputContract = action === "continue"
			? sharedContinueOutputInstruction()
			: sharedRewriteOutputInstruction();
		// A pressed action takes the candidate contract on either transport:
		// the button is the request, so the reply is judgment in front of a
		// mandatory labelled fence, never a maybe-proposal. The stack used to
		// send the proposal cautions and then a layer overriding them, and a
		// weaker model obeyed the caution — the 911-character 太冗长了 turn got
		// a comment on one sentence and no card. Now the contradiction is
		// never sent. Only the routed case — a Skill inferred from typed prose
		// — keeps the proposal contract, because there the cautions are the
		// semantics: the router guessed, and the model may decline.
		if (options.pressed && options.hasSelection) {
			addLayer(layers, "shared-output", "shared", outputContract, true);
			if (options.conversational) {
				addLayer(
					layers,
					"shared-pressed-action",
					"shared",
					pressedWritingActionInstruction(options.skill?.name),
					true,
				);
			}
		} else if (options.conversational) {
			addLayer(layers, "shared-proposal", "shared", sharedCandidateProposalInstruction(), true);
		} else {
			addLayer(layers, "shared-output", "shared", outputContract, true);
		}
	} else {
		// The card rides only conversation. The candidate transport's whole
		// reply is a passage, and a review Skill describes its own narrow job.
		if (!review) {
			addLayer(layers, "shared-capabilities", "shared", sharedCapabilityInstruction(), true);
		}
		if (review) {
			addLayer(layers, "shared-review", "shared", sharedReviewInstruction(), true);
		}
		addLayer(layers, "shared-citation", "shared", sharedCitationInstruction(), true);
		// A review Skill is defined by refusing to produce applicable text, so it
		// never gains the proposal channel. Nor does a turn with no passage to
		// propose against: `buildCandidate` would refuse it anyway.
		if (options.conversational && options.hasSelection && !review) {
			addLayer(layers, "shared-proposal", "shared", sharedCandidateProposalInstruction(), true);
		}
	}

	addLayer(layers, "project-customization", "project", options.projectCustomization, false);
	addLayer(layers, "task-skill", "skill", options.skill?.instruction, false);

	const frozenLayers = Object.freeze(layers.map((layer) => Object.freeze(layer)));
	return Object.freeze({
		text: frozenLayers.map((layer) => layer.text).join("\n\n"),
		layers: frozenLayers,
	});
}

function addLayer(
	layers: EffectiveInstructionLayer[],
	id: InstructionLayerId,
	owner: InstructionLayerOwner,
	value: string | undefined,
	immutable: boolean,
): void {
	const text = value?.trim();
	if (!text) return;
	layers.push({ id, owner, text, immutable });
}
