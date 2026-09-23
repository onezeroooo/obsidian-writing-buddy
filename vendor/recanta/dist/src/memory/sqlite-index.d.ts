import type { SqlDatabase } from "../store/driver.ts";
import type { FactKey } from "./contracts.ts";
export declare const MEMORY_INDEX_SCHEMA = "\nCREATE TABLE memory_slots (\n  namespace_id TEXT NOT NULL, scope_id TEXT NOT NULL, subject_id TEXT NOT NULL,\n  predicate TEXT NOT NULL, revision INTEGER NOT NULL, tokens TEXT NOT NULL,\n  PRIMARY KEY(namespace_id,scope_id,subject_id,predicate)\n) STRICT;\n";
/** Rebuildable current-slot projection; source freshness is checked on state reads. */
export declare class MemoryIndex {
    constructor(db: SqlDatabase);
    update(namespace: string, key: FactKey): void;
    rebuild(): void;
    discover(namespace: string, scopes: readonly string[], terms: readonly string[], limit: number): Array<FactKey & {
        score: number;
    }>;
}
