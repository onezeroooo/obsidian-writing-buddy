/**
 * The memory engine, vendored into this repository as readable source.
 *
 * Writing Buddy bundles Recanta into `main.js`. Until 0.1.6 the build resolved
 * it from a private Git dependency, which meant nobody outside this machine
 * could install the dependencies of the public repository, let alone build or
 * type-check it: every import in the plugin resolved to nothing, and the
 * Community directory's own lint reported the whole plugin as untyped.
 *
 * So the engine's built output lives here, in `vendor/recanta/`, and both the
 * private and the public tree resolve `recanta-dev` to exactly these files
 * (see `esbuild.config.mjs` and `tsconfig.json`). The private repository keeps
 * the pinned Git dependency as the source of truth for refreshing this copy
 * and for the provenance recorded in `recanta-manifest.json`; a test checks
 * that the vendored copy is byte for byte the pinned package.
 *
 *   node scripts/recanta-vendor.mjs            verify the copy against the pin
 *   node scripts/recanta-vendor.mjs --write    refresh it from the pin
 *
 * One normalisation is applied, and the comparison applies it too: the
 * `#private;` lines TypeScript emits into a declaration file for a class with
 * ES private fields are dropped. The directory's lint reads each of them as an
 * unused private member; they carry no type a caller can use, `tsc` passes
 * without them, and declarations are not bundled, so `main.js` is unaffected.
 */

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

export const VENDOR_DIR = path.join("vendor", "recanta");
/** Files this script writes itself; they are not part of the engine package and never compared against it. */
const OWN_FILES = ["VENDORED.md", "LICENSE"];
/** What the engine package ships and what this repository therefore carries. */
const VENDORED = ["dist/src", "package.json", "README.md"];

const NOTE = `# Vendored: the Recanta memory kernel

Generated. Do not edit by hand.

These are the built files of the memory engine Writing Buddy bundles into
\`main.js\`: the same bytes the plugin ships, in the form a reader can follow.
They are copied from one exact commit of the engine's own repository, with
one change: declaration files drop the \`#private;\` lines TypeScript emits
for classes with private fields, which carry no usable type;
\`../../recanta-manifest.json\` records which commit, which engine and schema
version, and the hash of this directory.

They are **not** covered by the MIT licence at the root of this repository:
see \`LICENSE\` in this directory.

They are here so that this repository installs, type-checks and builds for
anyone who clones it. Refresh them with \`node scripts/recanta-vendor.mjs
--write\` from the development repository, never by editing a file below.
`;

/** A file's bytes as this repository carries them: declaration files without their `#private;` markers. */
export function normalizeVendored(file, bytes) {
	if (!file.endsWith(".d.ts")) return bytes;
	const text = bytes.toString("utf8").replace(/^[ \t]*#private;[ \t]*\r?\n/gmu, "");
	return Buffer.from(text, "utf8");
}

/** Every vendored file, relative to the vendor directory, in a stable order. */
export function vendoredFiles(root = path.join(repoRoot, VENDOR_DIR)) {
	const out = [];
	const walk = (dir, prefix) => {
		if (!existsSync(dir)) return;
		for (const entry of readdirSync(dir).sort()) {
			const full = path.join(dir, entry);
			const relative = prefix ? `${prefix}/${entry}` : entry;
			if (statSync(full).isDirectory()) walk(full, relative);
			else out.push(relative);
		}
	};
	walk(root, "");
	return out.filter((file) => !OWN_FILES.includes(file)).sort();
}

/** A hash over the vendored files' names and contents: the identity of what this repository ships. */
export function vendorHash(root = path.join(repoRoot, VENDOR_DIR)) {
	const hash = createHash("sha256");
	for (const file of vendoredFiles(root)) {
		hash.update(file);
		hash.update("\0");
		hash.update(readFileSync(path.join(root, file)));
		hash.update("\0");
	}
	return `sha256:${hash.digest("hex")}`;
}

/** The installed pinned package, or null when this tree has no private dependency (the public snapshot). */
export function installedEngineDir() {
	try {
		return path.dirname(require.resolve("recanta-dev/package.json"));
	} catch {
		return null;
	}
}

function write() {
	const installed = installedEngineDir();
	if (!installed) {
		console.error("recanta-dev is not installed; run npm install in the development repository first.");
		process.exit(2);
	}
	const target = path.join(repoRoot, VENDOR_DIR);
	rmSync(target, { recursive: true, force: true });
	mkdirSync(target, { recursive: true });
	for (const entry of VENDORED) {
		const from = path.join(installed, entry);
		if (!existsSync(from)) continue;
		cpSync(from, path.join(target, entry), { recursive: true });
	}
	for (const file of vendoredFiles(target)) {
		const full = path.join(target, file);
		writeFileSync(full, normalizeVendored(file, readFileSync(full)));
	}
	writeFileSync(path.join(target, "VENDORED.md"), NOTE);
	// These files are not MIT like the rest of the repository; the licence travels with them.
	cpSync(path.join(repoRoot, "scripts", "recanta-license.txt"), path.join(target, "LICENSE"));
	const files = vendoredFiles(target);
	console.log(`vendored ${files.length} file(s) into ${VENDOR_DIR}: ${vendorHash(target)}`);
}

/** True when the vendored copy is exactly the installed pinned package. Null when there is nothing to compare against. */
export function vendorMatchesInstalled() {
	const installed = installedEngineDir();
	if (!installed) return null;
	const target = path.join(repoRoot, VENDOR_DIR);
	const differences = [];
	for (const file of vendoredFiles(target)) {
		const from = path.join(installed, file);
		if (!existsSync(from)) { differences.push(`${file}: not in the installed package`); continue; }
		if (!normalizeVendored(file, readFileSync(from)).equals(readFileSync(path.join(target, file)))) differences.push(`${file}: differs`);
	}
	for (const entry of VENDORED) {
		const from = path.join(installed, entry);
		if (!existsSync(from)) continue;
		const walk = (dir, prefix) => {
			for (const name of readdirSync(dir)) {
				const full = path.join(dir, name);
				const relative = prefix ? `${prefix}/${name}` : name;
				if (statSync(full).isDirectory()) walk(full, relative);
				else if (!existsSync(path.join(target, relative))) differences.push(`${relative}: not vendored`);
			}
		};
		if (statSync(from).isDirectory()) walk(from, entry);
		else if (!existsSync(path.join(target, entry))) differences.push(`${entry}: not vendored`);
	}
	return differences;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.includes("--write")) write();
	else {
		const differences = vendorMatchesInstalled();
		if (differences === null) {
			console.log(`${VENDOR_DIR}: ${vendorHash()} (no installed package to compare against)`);
		} else if (differences.length) {
			console.error(`${VENDOR_DIR} is stale; run node scripts/recanta-vendor.mjs --write\n  ${differences.slice(0, 20).join("\n  ")}`);
			process.exit(1);
		} else {
			console.log(`${VENDOR_DIR} matches the pinned package: ${vendorHash()}`);
		}
	}
}
