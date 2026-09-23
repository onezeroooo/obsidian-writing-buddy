import type { Evidence } from "../contracts.ts";
import type { ExtractedCandidate, SourceMetadata } from "./contracts.ts";
export interface CandidateDimensions {
    version: "candidate-dimensions-v1";
    qualifiers: Array<{
        raw: string;
        kind: "project" | "environment" | "region" | "version" | "unknown";
        value: string;
        start: number | null;
        end: number | null;
    }>;
    temporal: {
        raw: string;
        kind: "current" | "relative" | "absolute" | "before" | "after" | "unknown";
        anchor: string | null;
        timezone: string | null;
        /** Calendar-date interval, not UTC instants or automatic validity scheduling. */
        interval: {
            startDate: string;
            endDateExclusive: string;
        } | null;
        resolution: "anchored" | "unresolved";
        reason: string;
    } | null;
}
export declare function candidateDimensions(raw: ExtractedCandidate, evidence: Evidence, metadata: SourceMetadata): CandidateDimensions;
