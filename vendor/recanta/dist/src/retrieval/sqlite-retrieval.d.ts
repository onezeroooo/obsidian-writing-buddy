import type { SqlDatabase } from "../store/driver.ts";
import type { Access, Evidence, ScopeSnapshot } from "../contracts.ts";
import type { EvidenceCitation, SearchRequest, SearchResult, SearchSnapshot } from "./contracts.ts";
import { SqliteLexicalIndex } from "./sqlite-index.ts";
type SnapshotReader = (namespaceId: string, scopes: readonly string[]) => ScopeSnapshot;
type EvidenceReader = (access: Access, evidenceId: string) => Evidence;
type HeadReader = (access: Access, scopeId: string, sourceId: string) => {
    evidence: Evidence;
    deleted: boolean;
} | undefined;
export declare class SqliteEvidenceRetrieval {
    constructor(db: SqlDatabase, index: SqliteLexicalIndex, snapshot: SnapshotReader, evidence: EvidenceReader, head: HeadReader);
    search(access: Access, request: SearchRequest): SearchResult;
    resolve(access: Access, citation: EvidenceCitation, options?: {
        requireCurrent?: boolean;
    }): string;
    fresh(access: Access, snapshot: SearchSnapshot): boolean;
}
export {};
