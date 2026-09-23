/**
 * The API type definitions this plugin is written against, carried in the
 * repository so it type-checks without installing anything.
 *
 * Obsidian supplies these APIs at run time, so they are external at build
 * time and none of this reaches `main.js`. They still decide what the type
 * checker knows: without them every value that comes from Obsidian or from
 * CodeMirror is the `error` type that behaves as `any`, and every type-aware
 * lint rule fires on nearly every file. That is what an automated review of
 * this repository saw, because it type-checks the sources without installing
 * their dependencies.
 *
 * So the declaration files live under `vendor/types/`, and `tsconfig.json`
 * maps each module name to the copy here. They are third-party MIT code,
 * copied verbatim from the exactly pinned versions in `package.json`; a test
 * holds each copy to the installed package byte for byte, and
 * `vendor/types/VENDORED.md` records the versions and the licence.
 *
 *   node scripts/vendor-types.mjs            verify the copies against the pins
 *   node scripts/vendor-types.mjs --write    refresh them from node_modules
 */

import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const TYPES_DIR = path.join("vendor", "types");

/**
 * Every module the plugin's own sources, or one of these declaration files,
 * names. `obsidian` reaches for CodeMirror and `moment`; `@codemirror/view`
 * reaches for `style-mod`. A missing link makes the whole chain `any` again.
 */
export const VENDORED_TYPES = [
	{ module: "obsidian", file: "obsidian.d.ts" },
	{ module: "@codemirror/state", file: "state.d.ts" },
	{ module: "@codemirror/view", file: "view.d.ts" },
	{ module: "style-mod", file: "style-mod.d.ts" },
	{ module: "moment", file: "moment.d.ts" },
];

/**
 * Where a package keeps its declaration entry, and what version is installed.
 * Read from `node_modules` directly: a package whose `exports` map does not
 * list `./package.json` cannot be resolved through it, and several of these do not.
 */
function installed(module_) {
	const packageJson = path.join(repoRoot, "node_modules", ...module_.split("/"), "package.json");
	if (!existsSync(packageJson)) return null;
	const meta = JSON.parse(readFileSync(packageJson, "utf8"));
	const entry = meta.types ?? meta.typings;
	if (typeof entry !== "string") return null;
	return { version: meta.version, license: meta.license, file: path.resolve(path.dirname(packageJson), entry) };
}

export function vendoredTypeFiles(root = path.join(repoRoot, TYPES_DIR)) {
	if (!existsSync(root)) return [];
	return readdirSync(root).filter((name) => name.endsWith(".d.ts")).sort();
}

export function typesHash(root = path.join(repoRoot, TYPES_DIR)) {
	const hash = createHash("sha256");
	for (const file of vendoredTypeFiles(root)) {
		hash.update(file);
		hash.update("\0");
		hash.update(readFileSync(path.join(root, file)));
		hash.update("\0");
	}
	return `sha256:${hash.digest("hex")}`;
}

/** Differences between the vendored copies and the installed packages; null when nothing is installed to compare against. */
export function typesMatchInstalled() {
	const root = path.join(repoRoot, TYPES_DIR);
	const differences = [];
	let compared = 0;
	for (const entry of VENDORED_TYPES) {
		const from = installed(entry.module);
		if (!from) continue;
		compared += 1;
		const here = path.join(root, entry.file);
		if (!existsSync(here)) { differences.push(`${entry.file}: not vendored`); continue; }
		if (!readFileSync(from.file).equals(readFileSync(here))) differences.push(`${entry.file}: differs from ${entry.module}@${from.version}`);
	}
	if (compared === 0) return null;
	for (const file of vendoredTypeFiles(root)) {
		if (!VENDORED_TYPES.some((entry) => entry.file === file)) differences.push(`${file}: not one of the vendored modules`);
	}
	return differences;
}

function write() {
	const root = path.join(repoRoot, TYPES_DIR);
	const rows = [];
	rmSync(root, { recursive: true, force: true });
	mkdirSync(root, { recursive: true });
	for (const entry of VENDORED_TYPES) {
		const from = installed(entry.module);
		if (!from) {
			console.error(`${entry.module} is not installed; run npm install first.`);
			process.exit(2);
		}
		cpSync(from.file, path.join(root, entry.file));
		rows.push(`| \`${entry.module}\` | ${from.version} | ${from.license ?? "see the package"} | \`${entry.file}\` |`);
	}
	writeFileSync(path.join(root, "VENDORED.md"), `# Vendored: API type definitions

Generated. Do not edit by hand; refresh with \`node scripts/vendor-types.mjs --write\`.

These are the declaration files of the APIs Writing Buddy is written against.
Obsidian supplies these APIs at run time, so none of this code is in
\`main.js\`: they are here only so that this repository type-checks without
installing anything. Each is copied verbatim from the exactly pinned version
in \`../../package.json\`, and \`tsconfig.json\` maps the module name to the copy
here.

| Module | Version | Licence | File |
| --- | --- | --- | --- |
${rows.join("\n")}

Each remains under its own licence and copyright, held by its own authors.
`);
	console.log(`vendored ${rows.length} declaration file(s) into ${TYPES_DIR}: ${typesHash(root)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.includes("--write")) write();
	else {
		const differences = typesMatchInstalled();
		if (differences === null) console.log(`${TYPES_DIR}: ${typesHash()} (nothing installed to compare against)`);
		else if (differences.length) {
			console.error(`${TYPES_DIR} is stale; run node scripts/vendor-types.mjs --write\n  ${differences.join("\n  ")}`);
			process.exit(1);
		} else console.log(`${TYPES_DIR} matches the installed packages: ${typesHash()}`);
	}
}
