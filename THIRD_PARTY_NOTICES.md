# Third-party notices

## Runtime and bundled code

Writing Buddy vendors or bundles **no third-party source code** into its released `main.js`. The bundle is built from the TypeScript sources under `src/`. Dependencies in `package.json` are development tooling, type definitions, test tooling, or APIs supplied externally by Obsidian at runtime.

| Dependency | Role | License |
| --- | --- | --- |
| `esbuild` | Bundles `src/` into `main.js` | MIT |
| `typescript` | Type checking | Apache-2.0 |
| `vitest` | Test runner used in the private development workspace | MIT |
| `obsidian` | Obsidian API package; external at build time | MIT |
| `@codemirror/state` | Editor API used through Obsidian; external at build time | MIT |
| `@codemirror/view` | Editor API used through Obsidian; external at build time | MIT |
| `@types/node` | Type definitions | MIT |
| `tslib` | TypeScript helper library; not imported with `importHelpers: false` | 0BSD |

## Copied source code

**None.** No source file in Writing Buddy was copied from another project.

## Attribution obligations

Writing Buddy does not vendor third-party source. The dependency licenses above remain the licenses of their respective projects.
