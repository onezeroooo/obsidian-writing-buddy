import type { SqlDatabase } from "../store/driver.ts";
import type { Access } from "../contracts.ts";
import { type AdvancedRetrievalOptions, type AdvancedSearchRequest, type AdvancedSearchResult } from "./advanced-contracts.ts";
import type { SqliteEventStore } from "../store/sqlite.ts";
type Transaction = <T>(mode: "DEFERRED", action: () => T) => T;
/** Bounded exact-scan strategies for evaluation; no persistent vector index. */
export declare class AdvancedRetrieval {
    constructor(db: SqlDatabase, store: SqliteEventStore, transaction: Transaction, options?: AdvancedRetrievalOptions);
    search(access: Access, request: AdvancedSearchRequest): Promise<AdvancedSearchResult>;
}
export {};
