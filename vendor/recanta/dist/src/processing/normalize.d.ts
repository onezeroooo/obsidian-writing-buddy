import type { Evidence } from "../contracts.ts";
import type { Candidate, ExtractedCandidate, ProcessingRun, Vocabulary } from "./contracts.ts";
export declare const NORMALIZER_VERSION = "generic-scalar-dimensions-v2";
export declare const canonicalMention: (value: string) => string;
export declare function vocabulary(input?: Vocabulary): Required<Vocabulary>;
export declare function normalize(raw: ExtractedCandidate, index: number, run: ProcessingRun, evidence: Evidence, aliases: Required<Vocabulary>, method: Candidate["extraction"]["method"]): Candidate;
