import type { RewritePayload, TurnPayload } from "./AIBackend";
import { renderDocumentsBlock } from "../context/serialize";
import { instructionLocale } from "../i18n";
import { snapshotSafeTurnPayloadPaths } from "./safePath";

export interface AdapterMessage {
	role: "user" | "assistant";
	content: string;
}

export interface NativeSystemMessage {
	role: "system";
	content: string;
}

/**
 * The already-composed product/project/skill instructions.
 *
 * Direct and local adapters must put this value in the provider's native
 * system channel. It deliberately never becomes part of `adapterMessages`,
 * where supplied manuscript text could otherwise appear to have equal or
 * later instruction precedence.
 */
export function adapterInstructions(payload: TurnPayload): string | undefined {
	const instructions = payload.skill?.instructions;
	return instructions && instructions.trim().length > 0 ? instructions : undefined;
}

/** Add instructions to providers whose native system channel is a message. */
export function withSystemMessage(
	instructions: string | undefined,
	messages: AdapterMessage[],
): Array<NativeSystemMessage | AdapterMessage> {
	return instructions
		? [{ role: "system", content: instructions }, ...messages]
		: messages;
}

/** Embed supplied WritingBuddy context as user content for direct/local adapters. */
export function adapterMessages(payload: TurnPayload): AdapterMessage[] {
	const currentFile = payload.currentFile;
	const selection = payload.selection;
	const sourceDocuments = payload.documents;
	const safe = snapshotSafeTurnPayloadPaths({ currentFile, selection, documents: sourceDocuments });
	const selectionText = selection?.text;
	const selectionFilePath = safe.selectionFilePath;
	const messages = payload.messages.map((message) => ({ ...message }));
	const additions: string[] = [];
	const documents = renderDocumentsBlock(safe.documents);
	if (documents) additions.push(documents);
	const selectionInDocuments = selection && selectionFilePath !== undefined && safe.documents.some((document) =>
		document.text === selectionText && document.path.includes(selectionFilePath),
	);
	if (selection && selectionFilePath !== undefined && !selectionInDocuments) {
		const label = instructionLocale() === "en"
			? "Current selection (" + selectionFilePath + "):\n"
			: "当前选区（" + selectionFilePath + "）：\n";
		additions.push(label + selectionText);
	}
	if (additions.length === 0) return messages;
	const last = messages[messages.length - 1];
	if (!last || last.role !== "user") {
		return [...messages, { role: "user", content: additions.join("\n\n") }];
	}
	messages[messages.length - 1] = {
		...last,
		content: last.content + "\n\n---\n\n" + additions.join("\n\n"),
	};
	return messages;
}

export function rewriteMessages(payload: RewritePayload): AdapterMessage[] {
	// The effective instruction payload already owns the rewrite/continue
	// output contract. Direct and local adapters carry it in a native system
	// channel; adding another transport-specific tail here would send the same
	// directive twice.
	return adapterMessages(payload);
}
