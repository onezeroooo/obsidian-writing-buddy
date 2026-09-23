/**
 * The synchronous SQLite surface the kernel needs. It is the subset of Node's
 * `node:sqlite` `DatabaseSync` that the engine uses, so a Node host can pass a
 * `DatabaseSync` directly and a browser or mobile host can wrap a WebAssembly build
 * (sql.js, wa-sqlite, the official sqlite-wasm) behind the same shape. The kernel
 * never imports a database module itself.
 */
export type SqlValue = null | number | bigint | string | Uint8Array;
export type SqlRow = Record<string, SqlValue>;
export interface SqlStatement {
    get(...parameters: SqlValue[]): SqlRow | undefined;
    all(...parameters: SqlValue[]): SqlRow[];
    run(...parameters: SqlValue[]): unknown;
    iterate(...parameters: SqlValue[]): Iterable<SqlRow>;
}
export interface SqlDatabase {
    prepare(sql: string): SqlStatement;
    exec(sql: string): void;
    /** Registers a deterministic scalar SQL function used by the lexical projection. */
    function(name: string, options: {
        deterministic?: boolean;
    }, implementation: (...args: SqlValue[]) => SqlValue): void;
    close(): void;
}
/**
 * Node convenience: open a file or `:memory:` database through the built-in module.
 * Resolved at call time, so importing the kernel never touches `node:sqlite`; other
 * runtimes inject an `SqlDatabase` instead and receive a clear error otherwise.
 */
export declare function openBuiltinSqlite(filename: string): SqlDatabase;
export declare function isSqlDatabase(value: unknown): value is SqlDatabase;
