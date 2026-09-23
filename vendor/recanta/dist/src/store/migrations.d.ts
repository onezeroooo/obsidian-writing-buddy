import type { SqlDatabase } from "../store/driver.ts";
import type { SqliteLexicalIndex } from "../retrieval/sqlite-index.ts";
/** Called inside a single IMMEDIATE transaction, including every version bump. */
export declare function migrate(db: SqlDatabase, index: SqliteLexicalIndex, rebuild?: boolean): void;
