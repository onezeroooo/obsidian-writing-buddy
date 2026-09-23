import { check } from "../errors.js";
import { CLAIM_SCHEMA } from "../memory/sqlite-claims.js";
import { MEMORY_INDEX_SCHEMA, MemoryIndex } from "../memory/sqlite-index.js";
import { PROCESSING_SCHEMA } from "../processing/schema.js";
import { APPLICATION_ID, LIFECYCLE_SCHEMA, SCHEMA, SCHEMA_VERSION } from "./schema.js";
/** Called inside a single IMMEDIATE transaction, including every version bump. */
export function migrate(db, index, rebuild = false) {
    const application = Number(db.prepare("PRAGMA application_id").get()?.application_id);
    let version = Number(db.prepare("PRAGMA user_version").get()?.user_version);
    const existing = Number(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").get()?.n);
    if (application === 0 && version === 0 && existing === 0) {
        db.exec(SCHEMA);
        db.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1;`);
        version = 1;
    }
    else
        check(application === APPLICATION_ID, "FOREIGN_DATABASE", "Refusing to modify a database not owned by Recanta.");
    check(version >= 1 && version <= SCHEMA_VERSION, "UNSUPPORTED_SCHEMA", "Unsupported storage schema; migration is required.");
    const requireTables = (tables) => {
        for (const table of tables)
            check(db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name=?").get(table), "UNSUPPORTED_SCHEMA", "Storage schema is incomplete.");
    };
    requireTables(["namespaces", "scope_versions", "evidence", "source_heads", "changes"]);
    const migrations = {
        1: () => index.initialize(true),
        2: () => { requireTables(["passages", "search_metadata"]); db.exec(CLAIM_SCHEMA); },
        3: () => { requireTables(["claim_revisions"]); db.exec(PROCESSING_SCHEMA); db.exec(MEMORY_INDEX_SCHEMA); new MemoryIndex(db).rebuild(); },
        4: () => requireTables(["processing_runs", "source_lifecycle"]),
        // Runs carry the commit version of their last state change so their portable form can be exported incrementally.
        5: () => { if (!db.prepare("SELECT 1 FROM pragma_table_info('processing_runs') WHERE name='version'").get())
            db.exec("ALTER TABLE processing_runs ADD COLUMN version INTEGER NOT NULL DEFAULT 0; CREATE INDEX processing_version ON processing_runs(namespace_id,version);"); },
    };
    // Lifecycle columns are additive and every later projection rebuild reads them, so an
    // upgrade from any earlier schema applies them before replaying the numbered steps.
    if (version < SCHEMA_VERSION && !db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='source_lifecycle'").get()) {
        db.exec("ALTER TABLE source_heads ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0, 1)); ALTER TABLE source_heads ADD COLUMN position TEXT;");
        db.exec(LIFECYCLE_SCHEMA);
    }
    while (version < SCHEMA_VERSION) {
        migrations[version]();
        version++;
        db.exec(`PRAGMA user_version=${version};`);
    }
    requireTables(["claim_revisions", "processing_sources", "processing_runs", "processing_decisions", "memory_slots", "source_lifecycle", "artifact_ledger"]);
    if (rebuild) {
        index.rebuild();
        new MemoryIndex(db).rebuild();
    }
    index.initialize(false);
}
