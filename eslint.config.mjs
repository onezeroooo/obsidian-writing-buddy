import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

// The same rule set the Obsidian Community directory runs over each release,
// so a scorecard warning can be reproduced and fixed here before publishing.
export default defineConfig([
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: {
					allowDefaultProject: ["eslint.config.*"],
				},
			},
		},
	},
	{
		ignores: ["main.js", "node_modules/**", "scripts/**", "internal/**", "tests/**", "vendor/**"],
	},
]);
