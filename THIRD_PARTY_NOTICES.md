# Third-party notices

## Runtime and bundled code

The released `main.js` is built from the TypeScript sources under `src/` plus two bundled dependencies that provide novel memory: the Recanta memory kernel and SQLite compiled to WebAssembly (sql.js, embedded as bytes). Every other dependency in `package.json` is development tooling, type definitions, test tooling, or an API supplied externally by Obsidian at runtime.

| Dependency | Role | License |
| --- | --- | --- |
| Recanta (`vendor/recanta`) | Memory kernel bundled into `main.js` (evidence, reconciliation, retrieval, portable artifacts); the author’s own code, carried in this repository | all rights reserved, `vendor/recanta/LICENSE` |
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

The built files of the Recanta memory kernel are carried in this repository under `vendor/recanta/`, copied from one exact commit of the author’s own engine repository (declaration files without the `#private;` lines TypeScript emits); `recanta-manifest.json` records that commit and a hash of those files. They are the author’s own work and are **not** covered by this repository’s MIT licence: `vendor/recanta/LICENSE` states their terms, which allow reading them, building this repository, and redistributing them verbatim as part of an unmodified Writing Buddy, and reserve every other use. They are here so that the repository installs, type-checks and builds for anyone who clones it. No source file in Writing Buddy was copied from a project the author does not own; sql.js is consumed as a package and bundled by esbuild.

## Attribution obligations

The dependency licenses above remain the licenses of their respective projects. sql.js is MIT-licensed (its SQLite is public domain). Recanta is the author’s own memory kernel. Its built files are redistributed here under `vendor/recanta/` and bundled into `main.js`; `recanta-manifest.json` records the commit they came from and a hash over them. It is not published to any registry, and the plugin never installs, downloads or updates it at run time.
