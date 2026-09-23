import type { ExtractionOutput, ProviderUsage, SourceMetadata } from "./contracts.ts";
export declare function text(value: unknown, max?: number, allowEmpty?: boolean): asserts value is string;
export declare function metadata(value: SourceMetadata): SourceMetadata;
/**
 * The shape of the whole answer is the provider's to get right; one
 * candidate is not. A candidate that fails its own checks — a mention the
 * model resolved instead of copying, a field it invented, a quote it
 * altered — is set aside as a gap carrying the reason (when its quote is in
 * the source) and the rest of the passage is kept: a slip in one of thirty
 * candidates is not a reason to pay for the passage again. Candidates past
 * the limit are set aside the same way. `rejected` counts them for the host.
 */
export declare function validateOutput(input: unknown, content: string, maxBytes: number): ExtractionOutput;
/** Every meaningful source region is either a candidate or an explicit gap. */
export declare function completeCoverage(output: ExtractionOutput, content: string): ExtractionOutput;
export declare function usage(value: ProviderUsage): ProviderUsage;
