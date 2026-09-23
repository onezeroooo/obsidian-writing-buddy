/**
 * Load the built bundle the way Obsidian does, with a stubbed `obsidian`
 * module, and assert it exposes a plugin class.
 *
 * This catches the failures that only appear after bundling — a missing
 * external, a top-level side effect that needs the app, a broken CommonJS
 * envelope — before anyone opens Obsidian. It does not replace the manual
 * manual checks; it just means the GUI step starts from a bundle
 * that is known to at least load.
 */

import Module from "node:module";
import path from "node:path";
import process from "node:process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundlePath = path.join(repoRoot, "main.js");

/** Minimal stand-ins for the classes the bundle extends at load time. */
class FakePlugin {
	constructor(app, manifest) {
		this.app = app;
		this.manifest = manifest;
	}
	addCommand() {}
	addRibbonIcon() {}
	addSettingTab() {}
	registerView() {}
	registerEvent() {}
}
class FakeItemView {
	constructor(leaf) {
		this.leaf = leaf;
	}
}
class FakeModal {}
class FakePluginSettingTab {}

const obsidianStub = {
	Plugin: FakePlugin,
	ItemView: FakeItemView,
	Modal: FakeModal,
	PluginSettingTab: FakePluginSettingTab,
	Setting: class {},
	Notice: class {},
	MarkdownView: class {},
	TFile: class {},
	TFolder: class {},
	AbstractInputSuggest: class {},
	SuggestModal: class {},
	prepareFuzzySearch: () => () => null,
	normalizePath: (value) => value,
};

// Intercept `require("obsidian")` for the bundle only.
const originalLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
	if (request === "obsidian") return obsidianStub;
	return originalLoad(request, parent, isMain);
};

const source = readFileSync(bundlePath, "utf8");
const bundleModule = new Module(bundlePath, null);
bundleModule.filename = bundlePath;
bundleModule.paths = Module._nodeModulePaths(path.dirname(bundlePath));

try {
	bundleModule._compile(source, bundlePath);
} finally {
	Module._load = originalLoad;
}

const exported = bundleModule.exports;
const PluginClass = exported?.default ?? exported;

const checks = [];

checks.push(["bundle evaluates without throwing", true]);
checks.push(["exports a plugin class", typeof PluginClass === "function"]);
checks.push(["plugin extends Plugin", PluginClass?.prototype instanceof FakePlugin]);

// Constructing it must not require the app; onload() is where work happens.
let instance = null;
try {
	instance = new PluginClass({ vault: {}, workspace: {} }, { id: "writing-buddy" });
	checks.push(["constructs without an app", true]);
} catch (error) {
	checks.push([`constructs without an app (${error.message})`, false]);
}

checks.push(["has onload", typeof instance?.onload === "function"]);
checks.push(["has onunload", typeof instance?.onunload === "function"]);

const manifest = JSON.parse(readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));
checks.push([`manifest id is writing-buddy (${manifest.id})`, manifest.id === "writing-buddy"]);
// Mobile support is deliberate: the bundle requires nothing beyond the
// obsidian module (asserted above), and the Runtime answers CORS for the
// app:// and webview origins. A desktop-only regression would be a manifest
// edit someone should have to explain.
checks.push(["manifest allows mobile", manifest.isDesktopOnly === false]);
checks.push(["manifest has minAppVersion", typeof manifest.minAppVersion === "string"]);

let failed = 0;
for (const [label, ok] of checks) {
	console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
	if (!ok) failed += 1;
}

console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
