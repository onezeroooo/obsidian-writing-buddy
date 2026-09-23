/**
 * The SQLite WebAssembly binary, embedded in the bundle.
 *
 * esbuild inlines the `.wasm` file as bytes (see `esbuild.config.mjs`), so the
 * plugin never fetches executable code at run time and needs no file next to
 * `main.js` — the three-file Community layout stays intact and the same bytes
 * run on desktop and mobile. Tests resolve this module to a loader that reads
 * the same file from `node_modules` (see `vitest.config.mjs`).
 */

import bytes from "sql.js/dist/sql-wasm-browser.wasm";

export function sqlJsWasm(): Uint8Array {
	return bytes;
}
