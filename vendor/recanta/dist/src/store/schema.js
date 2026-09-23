/** Storage schema version, not a product release version. */
export const SCHEMA_VERSION = 6;
/** `SCHEMA` is the schema-1 base; every later version is reached through `migrate`, including on a fresh database. */
export const APPLICATION_ID = 0x52454341;
export const SCHEMA = `
CREATE TABLE namespaces (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0)
) STRICT;
CREATE TABLE scope_versions (
  namespace_id TEXT NOT NULL REFERENCES namespaces(id),
  scope_id TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation >= 0),
  PRIMARY KEY(namespace_id, scope_id)
) STRICT;
CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  namespace_id TEXT NOT NULL REFERENCES namespaces(id),
  scope_id TEXT NOT NULL,
  stream_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_version INTEGER NOT NULL CHECK(source_version > 0),
  subject_ids TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  occurred_at TEXT,
  recorded_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version > 0),
  UNIQUE(namespace_id, stream_id, event_id),
  UNIQUE(namespace_id, scope_id, source_id, source_version),
  UNIQUE(namespace_id, version)
) STRICT;
CREATE INDEX evidence_feed ON evidence(namespace_id, scope_id, version);
CREATE TABLE source_heads (
  namespace_id TEXT NOT NULL REFERENCES namespaces(id),
  scope_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_version INTEGER NOT NULL,
  evidence_id TEXT NOT NULL REFERENCES evidence(id),
  PRIMARY KEY(namespace_id, scope_id, source_id)
) STRICT;
CREATE TABLE changes (
  id TEXT PRIMARY KEY,
  namespace_id TEXT NOT NULL REFERENCES namespaces(id),
  scope_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL REFERENCES evidence(id),
  version INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind = 'evidence.ingested'),
  UNIQUE(namespace_id, version)
) STRICT;
CREATE INDEX changes_feed ON changes(namespace_id, scope_id, version);
`;
/**
 * Schema 5: document lifecycle. Deletion, restoration, invalidation and repositioning are
 * versioned ledger rows so they replay deterministically and export as portable artifacts.
 * `artifact_ledger` is device-local bookkeeping of imported artifact files; it is never exported.
 */
export const LIFECYCLE_SCHEMA = `
CREATE TABLE source_lifecycle (
  id TEXT PRIMARY KEY,
  namespace_id TEXT NOT NULL REFERENCES namespaces(id),
  scope_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  evidence_id TEXT REFERENCES evidence(id),
  kind TEXT NOT NULL CHECK(kind IN ('deleted', 'restored', 'invalidated', 'positioned')),
  reason TEXT,
  version INTEGER NOT NULL CHECK(version > 0),
  recorded_at TEXT NOT NULL,
  UNIQUE(namespace_id, version)
) STRICT;
CREATE INDEX lifecycle_source ON source_lifecycle(namespace_id, scope_id, source_id, version);
CREATE INDEX lifecycle_evidence ON source_lifecycle(evidence_id, kind);
CREATE TABLE artifact_ledger (
  name TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('applied', 'duplicate', 'divergent')),
  imported_at TEXT NOT NULL
) STRICT;
`;
