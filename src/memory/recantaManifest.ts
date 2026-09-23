/**
 * The embedded engine's identity, fixed at build time.
 *
 * esbuild defines `__WB_RECANTA__` from the exact pinned commit of the private
 * Recanta repository and the versions the installed package declares
 * (`scripts/recanta-manifest.mjs`). Nothing here is discovered at run time:
 * the plugin never installs, downloads or updates its engine, and a newer
 * Recanta reaches users only through a deliberate pin bump, rebuild and full
 * validation. The build check compares this constant with what the engine in
 * the bundle actually reports.
 */

export interface RecantaManifest {
	package: string;
	commit: string;
	version: string;
	engine: string;
	schemaVersion: number;
	artifactFormat: number;
	source: string;
}

declare const __WB_RECANTA__: RecantaManifest | undefined;

const FALLBACK: RecantaManifest = { package: "recanta-dev", commit: "", version: "", engine: "recanta", schemaVersion: 0, artifactFormat: 0, source: "unbundled (tests)" };

export const RECANTA_MANIFEST: RecantaManifest = typeof __WB_RECANTA__ === "object" && __WB_RECANTA__ !== null ? __WB_RECANTA__ : FALLBACK;
