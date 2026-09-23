# Vendored: the Recanta memory kernel

Generated. Do not edit by hand.

These are the built files of the memory engine Writing Buddy bundles into
`main.js`: the same bytes the plugin ships, in the form a reader can follow.
They are copied from one exact commit of the engine's own repository, with
one change: declaration files drop the `#private;` lines TypeScript emits
for classes with private fields, which carry no usable type;
`../../recanta-manifest.json` records which commit, which engine and schema
version, and the hash of this directory.

They are **not** covered by the MIT licence at the root of this repository:
see `LICENSE` in this directory.

They are here so that this repository installs, type-checks and builds for
anyone who clones it. Refresh them with `node scripts/recanta-vendor.mjs
--write` from the development repository, never by editing a file below.
