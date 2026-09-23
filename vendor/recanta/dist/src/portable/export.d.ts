import type { Access } from "../contracts.ts";
import type { SqlDatabase } from "../store/driver.ts";
import type { ExportRequest, ExportResult } from "./contracts.ts";
/**
 * Portable knowledge = authoritative rows only: evidence with its extraction output and
 * decisions, fact transitions and lifecycle events. Indexes, slots, snapshots, change feed
 * and the artifact ledger are device-local and rebuilt on import.
 */
export declare function exportArtifacts(db: SqlDatabase, access: Access, request: ExportRequest): ExportResult;
