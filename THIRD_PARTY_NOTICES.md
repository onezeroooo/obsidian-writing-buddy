# Third-party notices

## Runtime and bundled code

WritingBuddy ships **no third-party source code** in its bundle. `main.js` is
built exclusively from the TypeScript sources under `src/`. Every dependency in
`package.json` is a `devDependency` (build tooling, type definitions, test
runner) and none of them are bundled into the released artifact.

| Dependency | Role | License |
| --- | --- | --- |
| `esbuild` | bundles `src/` into `main.js` | MIT |
| `typescript` | type-checking only | Apache-2.0 |
| `vitest` | test runner | MIT |
| `obsidian` | API type definitions only (`external` at build time) | MIT |
| `@types/node` | type definitions only | MIT |
| `tslib` | TypeScript helper library (unused at `importHelpers: false`) | 0BSD |

## Copied source code

**None.** No file in this repository was copied from another project.

## Attribution obligations

No code was copied into this repository, so WritingBuddy carries no attribution
obligation beyond the dependency licences listed above.
