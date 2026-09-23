import type { SqlDatabase } from "../store/driver.ts";
/** Part of the evidence/source-head transaction, including low-level ingests. */
export declare function supersedeProcessing(db: SqlDatabase, evidenceId: string): void;
