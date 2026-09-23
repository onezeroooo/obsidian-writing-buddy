/**
 * The embedded memory engine, as a machine-verifiable record.
 *
 * Writing Buddy embeds Recanta at build time from one exact commit of its
 * private repository. This module reads that pin from `package.json`, the
 * resolved commit from the lockfile, and the engine, schema and artifact
 * versions from the installed package, and hands them to the bundle (as the
 * `__WB_RECANTA__` constant) and to `recanta-manifest.json`. A test checks
 * that all four agree with each other and with what the engine reports at
 * run time, so a bump is always a deliberate change to the pin, a rebuild and
 * a green suite — never a floating range, a branch, or a download.
 *
 * Usage: `node scripts/recanta-manifest.mjs --write` refreshes the JSON file;
 * without `--write` it prints the manifest and exits non-zero on disagreement.
 */

import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
export const MANIFEST_FILE = "recanta-manifest.json";

function pinnedCommit(spec) {
	const match = /^github:onezeroooo\/recanta-dev#([0-9a-f]{40})$/u.exec(spec ?? "");
	if (!match) throw new Error(`recanta-dev must be pinned as github:onezeroooo/recanta-dev#<40-hex commit>; got ${JSON.stringify(spec)}`);
	return match[1];
}

export async function resolveRecantaManifest() {
	const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
	const lock = JSON.parse(readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"));
	const commit = pinnedCommit(pkg.devDependencies?.["recanta-dev"]);
	const lockEntry = lock.packages?.["node_modules/recanta-dev"];
	const lockCommit = /#([0-9a-f]{40})$/u.exec(lockEntry?.resolved ?? "")?.[1];
	if (lockCommit !== commit) throw new Error(`package-lock.json resolves recanta-dev to ${lockCommit ?? "nothing"}, package.json pins ${commit}`);
	const installed = JSON.parse(readFileSync(require.resolve("recanta-dev/package.json"), "utf8"));
	const versionModule = await import(pathToFileURL(path.join(path.dirname(require.resolve("recanta-dev/package.json")), "dist/src/version.js")).href);
	const schemaModule = await import(pathToFileURL(path.join(path.dirname(require.resolve("recanta-dev/package.json")), "dist/src/store/schema.js")).href);
	if (versionModule.ENGINE_VERSION !== installed.version) throw new Error(`installed recanta-dev ${installed.version} reports ENGINE_VERSION ${versionModule.ENGINE_VERSION}`);
	return {
		package: "recanta-dev",
		commit,
		version: installed.version,
		engine: versionModule.ENGINE_NAME,
		schemaVersion: schemaModule.SCHEMA_VERSION,
		artifactFormat: versionModule.ARTIFACT_FORMAT,
		source: "private build-time dependency; embedded into main.js, never installed or fetched at run time",
	};
}

export function readRecantaManifest() {
	return JSON.parse(readFileSync(path.join(repoRoot, MANIFEST_FILE), "utf8"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const manifest = await resolveRecantaManifest();
	const text = JSON.stringify(manifest, null, "\t") + "\n";
	if (process.argv.includes("--write")) {
		writeFileSync(path.join(repoRoot, MANIFEST_FILE), text);
		console.log(`wrote ${MANIFEST_FILE}: recanta ${manifest.version} @ ${manifest.commit.slice(0, 7)}, schema ${manifest.schemaVersion}, artifact format ${manifest.artifactFormat}`);
	} else {
		process.stdout.write(text);
		const recorded = readRecantaManifest();
		if (JSON.stringify(recorded) !== JSON.stringify(manifest)) { console.error(`${MANIFEST_FILE} is stale; run node scripts/recanta-manifest.mjs --write`); process.exit(1); }
	}
}
