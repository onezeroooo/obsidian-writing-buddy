import type { Access, Evidence } from "../contracts.ts";
import type { FactKey, FactState } from "../memory/contracts.ts";
import type { SqlDatabase, SqlValue } from "../store/driver.ts";
import type { AffectedFact, DocumentRevision, RetainDocumentOptions } from "./contracts.ts";
export declare const DOCUMENT_STREAM = "documents";
export declare const documentEventId: (sourceId: string, revision: number) => string;
export declare function validateDocument(document: DocumentRevision): DocumentRevision & {
    contentHash: string;
};
export declare function validateRetainOptions(options: RetainDocumentOptions): void;
type FactReader = (access: Access, key: FactKey) => Omit<FactState, "snapshot">;
/** Fact slots whose latest revision still carries a claim citing any of these evidence ids. */
export declare function affectedFacts(db: SqlDatabase, access: Access, scopeId: string, evidenceIds: readonly string[], read: FactReader): AffectedFact[];
export interface LifecycleContext {
    db: SqlDatabase;
    access: Access;
    scopeId: string;
    sourceId: string;
}
/** Allocates the next namespace commit version and invalidates the scope's snapshots. Caller owns the transaction. */
export declare function commitVersion(db: SqlDatabase, namespaceId: string, scopeId: string): number;
/**
 * Lifecycle rows are identified by what happened, not by the device: the same transition at the
 * same point of a source's history gets the same id everywhere, so two devices that both record
 * it produce one artifact rather than two.
 */
export declare function lifecycleId(db: SqlDatabase, namespaceId: string, scopeId: string, sourceId: string, kind: string, evidenceId: string | null, reason: string | null): string;
export declare function recordLifecycle(db: SqlDatabase, context: LifecycleContext, kind: "deleted" | "restored" | "invalidated" | "positioned", evidenceId: string | null, reason: string | null, version: number, recordedAt: string): string;
export declare function isInvalidated(db: SqlDatabase, evidenceId: string): boolean;
export declare function validateReason(reason: unknown): string | null;
export declare function sourceRevisionCount(db: SqlDatabase, access: Access, scopeId: string, sourceId: string): number;
export declare function latestRun(db: SqlDatabase, evidenceId: string): {
    id: string;
    status: string;
} | null;
export declare function scopeParams(access: Access, scopeId: string, mode: "read" | "write"): SqlValue[];
export type HeadLookup = (access: Access, scopeId: string, sourceId: string) => {
    evidence: Evidence;
    deleted: boolean;
    position: string | null;
} | undefined;
export {};
