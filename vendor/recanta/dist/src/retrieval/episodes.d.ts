import type { SqlDatabase } from "../store/driver.ts";
import type { Access, EventKind } from "../contracts.ts";
import type { ProcessingRun, SourceMetadata } from "../processing/contracts.ts";
import type { EvidenceCitation, SearchSnapshot } from "./contracts.ts";
import type { SqliteEventStore } from "../store/sqlite.ts";
export interface EpisodeRequest {
    scopes: readonly string[];
    query: string;
    limit?: number;
    neighborLimit?: number;
    maxBytes: number;
}
export interface EpisodeEvent {
    evidenceId: string;
    kind: EventKind;
    occurredAt: string | null;
    version: number;
    text: string;
    citation: EvidenceCitation;
    metadata: SourceMetadata | null;
    processing: Array<{
        id: string;
        status: ProcessingRun["status"];
        decisions: ProcessingRun["decisions"];
    }>;
}
export interface EpisodeBody {
    format: "recanta-episodes-v1";
    interpretation: string;
    episodes: Array<{
        scopeId: string;
        streamId: string;
        score: number;
        anchorEvidenceId: string;
        events: EpisodeEvent[];
        hasMoreEvents: boolean;
    }>;
    omittedEpisodes: number;
    hasMoreEpisodes: boolean;
}
export interface EpisodeResult {
    text: string;
    bytes: number;
    snapshot: SearchSnapshot;
}
/** A bounded stream neighborhood, not an inferred episode or universal experience graph. */
export declare class EpisodeRetrieval {
    constructor(db: SqlDatabase, store: SqliteEventStore);
    search(access: Access, request: EpisodeRequest): EpisodeResult;
}
