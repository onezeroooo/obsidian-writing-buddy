/**
 * The embedded memory engine, as a machine-verifiable record.
 *
 * Writing Buddy bundles the copy of the engine this repository carries under
 * `vendor/recanta/` (see `scripts/recanta-vendor.mjs`), so the versions and the
 * hash it records always describe what is actually built. The development tree
 * additionally pins the engine's repository as a Git dependency: there the
 * pinned commit and the lockfile must agree, and a test holds the vendored copy
 * to that package byte for byte, so a bump is always a deliberate change to the
 * pin, a refreshed vendor directory, a rebuild and a green suite — never a
 * floating range, a branch, or a download. The public snapshot has no such
 * dependency; it carries the commit in `recanta-manifest.json` and the files the
 * hash covers.
 *
 * Usage: `node scripts/recanta-manifest.mjs --write` refreshes the JSON file;
 * without `--write` it prints the manifest and exits non-zero on disagreement.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { VENDOR_DIR, vendorHash } from "./recanta-vendor.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MANIFEST_FILE = "recanta-manifest.json";

function pinnedCommit(spec) {
	const match = /^github:onezeroooo\/recanta-dev#([0-9a-f]{40})$/u.exec(spec ?? "");
	if (!match) throw new Error(`recanta-dev must be pinned as github:onezeroooo/recanta-dev#<40-hex commit>; got ${JSON.stringify(spec)}`);
	return match[1];
}

/**
 * The commit the vendored copy came from: the pin when this tree has one, and
 * otherwise what the committed manifest records. A tree with a pin must agree
 * with its own lockfile.
 */
function vendoredCommit() {
	const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
	const spec = pkg.devDependencies?.["recanta-dev"];
	if (spec === undefined) return readRecantaManifest().commit;
	const commit = pinnedCommit(spec);
	const lock = JSON.parse(readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"));
	const lockCommit = /#([0-9a-f]{40})$/u.exec(lock.packages?.["node_modules/recanta-dev"]?.resolved ?? "")?.[1];
	if (lockCommit !== commit) throw new Error(`package-lock.json resolves recanta-dev to ${lockCommit ?? "nothing"}, package.json pins ${commit}`);
	return commit;
}

export async function resolveRecantaManifest() {
	const vendorDir = path.join(repoRoot, VENDOR_DIR);
	const vendored = JSON.parse(readFileSync(path.join(vendorDir, "package.json"), "utf8"));
	const versionModule = await import(pathToFileURL(path.join(vendorDir, "dist/src/version.js")).href);
	const schemaModule = await import(pathToFileURL(path.join(vendorDir, "dist/src/store/schema.js")).href);
	if (versionModule.ENGINE_VERSION !== vendored.version) throw new Error(`vendored recanta-dev ${vendored.version} reports ENGINE_VERSION ${versionModule.ENGINE_VERSION}`);
	return {
		package: "recanta-dev",
		commit: vendoredCommit(),
		version: vendored.version,
		engine: versionModule.ENGINE_NAME,
		schemaVersion: schemaModule.SCHEMA_VERSION,
		artifactFormat: versionModule.ARTIFACT_FORMAT,
		vendor: vendorHash(vendorDir),
		source: "the author's own memory kernel, vendored into this repository under vendor/recanta and bundled into main.js; never installed, downloaded or updated at run time",
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
		console.log(`wrote ${MANIFEST_FILE}: recanta ${manifest.version} @ ${manifest.commit.slice(0, 7)}, schema ${manifest.schemaVersion}, artifact format ${manifest.artifactFormat}, ${manifest.vendor}`);
	} else {
		process.stdout.write(text);
		const recorded = readRecantaManifest();
		if (JSON.stringify(recorded) !== JSON.stringify(manifest)) { console.error(`${MANIFEST_FILE} is stale; run node scripts/recanta-manifest.mjs --write`); process.exit(1); }
	}
}
