import type { SqlDatabase } from "../store/driver.ts";
import type { SearchHit } from "./contracts.ts";
export declare function fts5Available(db: SqlDatabase): boolean;
/** Internal projection. The caller owns transactions and trusted scope checks. */
export declare class SqliteLexicalIndex {
    constructor(db: SqlDatabase);
    /** The acceleration structure this runtime can maintain; part of the local index identity. */
    get acceleration(): "fts5" | "scan";
    initialize(create: boolean): void;
    assertCompatible(): void;
    /** Local maintenance operation; must run inside the owner's write transaction. */
    rebuild(): void;
    replace(previousEvidenceId: string | undefined, evidenceId: string, content: string): void;
    remove(evidenceId: string): void;
    insert(evidenceId: string, content: string): void;
    candidates(namespace: string, scopes: readonly string[], terms: readonly string[], limit: number, subjectId?: string): SearchHit[];
}
