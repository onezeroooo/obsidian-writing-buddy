declare module "sql.js/dist/sql-wasm-browser.js" {
	interface SqlJsStatement {
		bind(values?: unknown[]): boolean;
		step(): boolean;
		getAsObject(): Record<string, unknown>;
		free(): boolean;
	}
	interface SqlJsDatabase {
		prepare(sql: string): SqlJsStatement;
		exec(sql: string): unknown;
		run(sql: string, params?: unknown[]): unknown;
		create_function(name: string, implementation: (...args: never[]) => unknown): unknown;
		export(): Uint8Array;
		close(): void;
	}
	interface SqlJsStatic {
		Database: new (data?: Uint8Array | ArrayLike<number> | null) => SqlJsDatabase;
	}
	const initSqlJs: (config?: { wasmBinary?: Uint8Array | ArrayBuffer; locateFile?: (file: string) => string }) => Promise<SqlJsStatic>;
	export default initSqlJs;
}

declare module "*.wasm" {
	const bytes: Uint8Array;
	export default bytes;
}
