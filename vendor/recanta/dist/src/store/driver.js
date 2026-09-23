import { check } from "../errors.js";
/**
 * Node convenience: open a file or `:memory:` database through the built-in module.
 * Resolved at call time, so importing the kernel never touches `node:sqlite`; other
 * runtimes inject an `SqlDatabase` instead and receive a clear error otherwise.
 */
export function openBuiltinSqlite(filename) {
    const process = globalThis.process;
    const module = typeof process?.getBuiltinModule === "function" ? process.getBuiltinModule("node:sqlite") : undefined;
    check(module && typeof module.DatabaseSync === "function", "UNSUPPORTED_RUNTIME", "No built-in SQLite in this runtime; construct the store with an injected SqlDatabase driver (see docs/host-contract.md).");
    return new module.DatabaseSync(filename);
}
export function isSqlDatabase(value) {
    return typeof value === "object" && value !== null && typeof value.prepare === "function" && typeof value.exec === "function" && typeof value.close === "function";
}
