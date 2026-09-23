export const PROCESSING_SCHEMA = `
CREATE TABLE processing_sources (
  evidence_id TEXT PRIMARY KEY REFERENCES evidence(id),
  metadata TEXT NOT NULL
) STRICT;
CREATE TABLE processing_runs (
  id TEXT PRIMARY KEY,
  namespace_id TEXT NOT NULL REFERENCES namespaces(id),
  scope_id TEXT NOT NULL,
  evidence_id TEXT NOT NULL REFERENCES evidence(id),
  pipeline_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('requested','processing','completed','partial','failed','superseded')),
  body TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  UNIQUE(namespace_id,evidence_id,pipeline_fingerprint)
) STRICT;
CREATE INDEX processing_scope ON processing_runs(namespace_id,scope_id,status);
CREATE INDEX processing_version ON processing_runs(namespace_id,version);
CREATE TABLE processing_decisions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES processing_runs(id),
  namespace_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  subject_id TEXT,
  predicate TEXT,
  claim_id TEXT,
  evidence_id TEXT NOT NULL REFERENCES evidence(id),
  body TEXT NOT NULL
) STRICT;
CREATE INDEX decisions_claim ON processing_decisions(namespace_id,scope_id,claim_id);
CREATE INDEX decisions_slot ON processing_decisions(namespace_id,scope_id,subject_id,predicate);
`;
