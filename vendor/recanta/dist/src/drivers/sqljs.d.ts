import type { SqlDatabase } from "../store/driver.ts";
/**
 * Reference adapter from a sql.js `Database` (SQLite compiled to WebAssembly) to the
 * kernel's `SqlDatabase` contract. The host initializes sql.js itself and passes the
 * open database; this module has no dependency on sql.js and only describes the
 * methods it calls. Persistence is the host's job: `Database.export()` yields the bytes
 * to write through a storage adapter, and a fresh `new SQL.Database(bytes)` reopens them.
 *
 * sql.js builds ship without FTS5; the kernel detects that and keeps identical retrieval
 * results through its bounded scan path.
 */
export interface SqlJsStatementLike {
    bind(values?: unknown[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): boolean;
}
export interface SqlJsDatabaseLike {
    prepare(sql: string): SqlJsStatementLike;
    exec(sql: string): unknown;
    run(sql: string, params?: unknown[]): unknown;
    create_function(name: string, implementation: (...args: never[]) => unknown): unknown;
    export(): Uint8Array;
    close(): void;
}
/** The kernel's driver plus the host's persistence hook. */
export interface SqlJsDriver extends SqlDatabase {
    /**
     * The database bytes for the host to store. sql.js closes and reopens its handle to
     * export, which drops every registered SQL function; this re-registers the kernel's
     * functions so the same driver keeps working after a save.
     */
    export(): Uint8Array;
}
export declare function sqlJsDriver(database: SqlJsDatabaseLike): SqlJsDriver;
