import type { Access, Evidence } from "../contracts.ts";
import { SqliteLexicalIndex } from "../retrieval/sqlite-index.ts";
import type { SqlDatabase } from "../store/driver.ts";
import type { ImportIssue, ImportReport, PortableArtifact } from "./contracts.ts";
type Transaction = <T>(mode: "IMMEDIATE" | "DEFERRED", action: () => T) => T;
type HeadReader = (scopeId: string, sourceId: string) => {
    evidence: Evidence;
    deleted: boolean;
    position: string | null;
} | undefined;
/**
 * Applies portable artifacts to the local store. Every artifact is idempotent, order-tolerant
 * within its dependencies and applied under its own savepoint, so a corrupt, foreign or
 * conflicting file can only skip itself. Nothing here invokes a provider: restored runs carry
 * their extraction output, and runs without one are merely listed as needing processing.
 */
export declare class ArtifactImporter {
    constructor(db: SqlDatabase, transaction: Transaction, index: SqliteLexicalIndex, head: HeadReader, access: Access);
    import(artifacts: readonly PortableArtifact[]): ImportReport;
    /** Marks artifacts written by this device as applied so a later import does not reread its own files. */
    recordOwn(artifacts: readonly PortableArtifact[]): void;
    knownNames(): Set<string>;
}
export declare const issueSummary: (issues: readonly ImportIssue[]) => string;
export {};
