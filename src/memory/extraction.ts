/**
 * Extraction providers Writing Buddy hands to Recanta.
 *
 * Recanta owns what happens to an extraction: validation of every span,
 * normalization through the book's vocabulary, reconciliation against what
 * is already known, and the portable artifact that carries the output to
 * other devices so the model is never asked twice for the same text. What
 * Writing Buddy owns is only *which* model answers and how it is asked.
 *
 * Two providers live here. The golden provider replays hand-authored
 * expectations and is the deterministic fixture every blocking test runs on.
 * The backend provider (`backendExtraction.ts`) asks the writer's own
 * connection and is the production path; it is qualified separately because
 * a live model is not deterministic.
 */

import type { ExtractionInput, ExtractionProvider, ProviderUsage } from "recanta-dev";

export type { ExtractionProvider } from "recanta-dev";

/**
 * The shape an extraction output takes on the wire between Recanta and its
 * provider. Kept here only so a fixture can author golden outputs with the
 * right field names; Recanta validates the real thing. Subject, predicate
 * and value are raw mentions and must each occur inside `quote`.
 */
export interface GoldenCandidate {
	subject: string;
	predicate: string;
	value: string;
	assertionMode?: "assertion" | "proposal" | "hypothesis" | "quotation" | "negation";
	intent?: "assert" | "correct" | "retract";
	/** The exact sentence the candidate rests on; offsets are computed from it. */
	quote: string;
	qualifiers?: string[];
	temporalExpression?: string | null;
	confidence?: number | null;
}

/**
 * Deterministic extraction from hand-authored expectations, for tests.
 *
 * The golden file names candidates by the sentence they rest on; this
 * provider locates each quote in the text it is asked about and emits a
 * span-backed candidate. Text that no golden entry covers is reported as
 * unresolved, which is what a careful model does with prose it cannot reduce
 * to a statement.
 */
export class GoldenExtractionProvider implements ExtractionProvider {
	readonly fingerprint: string;
	readonly method = "model" as const;
	calls = 0;
	/** Every text the provider was asked about, in order, for assertions on what was (not) analyzed. */
	readonly asked: string[] = [];

	constructor(private readonly golden: readonly GoldenCandidate[], name = "golden-novel-fixture-v1") {
		this.fingerprint = name;
	}

	async extract(input: ExtractionInput): Promise<{ output: unknown; usage: ProviderUsage }> {
		this.calls += 1;
		const text = input.evidence.content;
		this.asked.push(text);
		const candidates = [];
		const covered: Array<[number, number]> = [];
		for (const entry of this.golden) {
			let from = 0;
			for (;;) {
				const start = text.indexOf(entry.quote, from);
				if (start === -1) break;
				const end = start + entry.quote.length;
				from = end;
				if (covered.some(([a, b]) => start < b && end > a)) continue;
				covered.push([start, end]);
				candidates.push({
					subject: entry.subject,
					predicate: entry.predicate,
					value: entry.value,
					assertionMode: entry.assertionMode ?? "assertion",
					intent: entry.intent ?? "assert",
					span: { start, end, quote: entry.quote },
					qualifiers: entry.qualifiers ?? [],
					temporalExpression: entry.temporalExpression ?? null,
					confidence: entry.confidence ?? null,
					uncertainty: [],
				});
				if (candidates.length >= 32) break;
			}
		}
		const unresolved = uncoveredSentences(text, covered).map((span) => ({ ...span, reason: "Narrative prose outside the golden expectations." })).slice(0, 32);
		return { output: { candidates, unresolved }, usage: { inputTokens: 0, outputTokens: 0 } };
	}
}

function uncoveredSentences(text: string, covered: ReadonlyArray<[number, number]>): Array<{ start: number; end: number; quote: string }> {
	const spans: Array<{ start: number; end: number; quote: string }> = [];
	for (const match of text.matchAll(/[^\n。！？.!?]+[。！？.!?]?/gu)) {
		const quote = match[0].trim();
		if (!quote) continue;
		const start = match.index + match[0].indexOf(quote);
		const end = start + quote.length;
		const overlaps = covered.some(([from, to]) => start < to && end > from);
		if (!overlaps) spans.push({ start, end, quote });
	}
	return spans;
}
