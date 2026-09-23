# Third-party notices

## Runtime and bundled code

The released `main.js` is built from the TypeScript sources under `src/` plus two bundled dependencies that provide novel memory: the Recanta memory kernel and SQLite compiled to WebAssembly (sql.js, embedded as bytes). Every other dependency in `package.json` is development tooling, type definitions, test tooling, or an API supplied externally by Obsidian at runtime.

| Dependency | Role | License |
| --- | --- | --- |
| `recanta-dev` | Memory kernel bundled into `main.js` (evidence, reconciliation, retrieval, portable artifacts) | see below |
| `sql.js` | SQLite compiled to WebAssembly, bundled into `main.js` as bytes | MIT (SQLite is public domain) |
| `esbuild` | Bundles `src/` into `main.js` | MIT |
| `typescript` | Type checking | Apache-2.0 |
| `vitest` | Test runner used in the private development workspace | MIT |
| `obsidian` | Obsidian API package; external at build time | MIT |
| `@codemirror/state` | Editor API used through Obsidian; external at build time | MIT |
| `@codemirror/view` | Editor API used through Obsidian; external at build time | MIT |
| `@types/node` | Type definitions | MIT |
| `tslib` | TypeScript helper library; not imported with `importHelpers: false` | 0BSD |

## Copied source code

**None.** No source file in Writing Buddy was copied from another project; Recanta and sql.js are consumed as packages and bundled by esbuild.

## Attribution obligations

The dependency licenses above remain the licenses of their respective projects. sql.js is MIT-licensed (its SQLite is public domain). Recanta is the author's own private memory kernel, embedded at build time from one exact commit (`recanta-manifest.json` records which); it is not redistributed as source, not published to any registry, and never installed, downloaded or updated by the plugin at run time.
