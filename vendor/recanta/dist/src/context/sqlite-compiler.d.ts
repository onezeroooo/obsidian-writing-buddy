import type { SqlDatabase } from "../store/driver.ts";
import type { Access, ScopeSnapshot } from "../contracts.ts";
import { SqliteClaims } from "../memory/sqlite-claims.ts";
import { SqliteLexicalIndex } from "../retrieval/sqlite-index.ts";
import type { ContextRequest, ContextResult } from "./contracts.ts";
type SnapshotReader = (namespaceId: string, scopes: readonly string[]) => ScopeSnapshot;
/** Low-level explicit-fact compiler. The owner provides one read transaction. */
export declare class SqliteContextCompiler {
    #private;
    constructor(db: SqlDatabase, claims: SqliteClaims, index: SqliteLexicalIndex, snapshot: SnapshotReader);
    compile(access: Access, request: ContextRequest): ContextResult;
}
export {};
