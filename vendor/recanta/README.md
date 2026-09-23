# Recanta

Lightweight evidence, memory, retrieval, and context infrastructure for long-lived agents.

This private repository currently implements **transactional evidence storage, explicit fact state, an owned raw-input memory loop, and an observable retrieval-to-context pipeline**. It is not production-qualified. All implementation is host-independent; no product-specific adapter is included.

## Quick start

Use Node 24 (at least 24.12), then run npm ci and npm run demo:memory. The demo retains raw messages, corrects a budget, preserves a proposal, restarts and recalls current memory without hand-authored fact keys. See [the memory processing guide](docs/memory-processing.md) for the high-level API and explicit model configuration.

## Product responsibility

Recanta owns extraction, normalization, reconciliation and task-relevant memory selection. Ordinary hosts should supply raw inputs and access/source metadata, with optional domain policies and a configured inference provider. SqliteRecanta now supplies retain, processingStatus, retryProcessing and recallContext, with offline rules or an explicitly configured model provider. See [memory processing](docs/memory-processing.md).

## Implemented

- Durable events with exact source content, source revisions and content hashes.
- Namespace and scope checks supplied by a trusted host.
- Idempotent event replay and explicit payload/version conflicts.
- Atomic evidence, source-head, generation and change-feed writes.
- Scope snapshots that detect new evidence, including changes to previously empty scopes.
- Current source heads plus historical event feeds.
- Schema ownership/version checks and restart persistence.
- Scoped lexical retrieval of current source passages with exact original-text references.
- Atomic search-index replacement, transactional schema-1 migration, and explicit index rebuild.
- Explicit fact add/replace/retract, slot revision CAS, conflict preservation and known-at history.
- Evidence-backed memory with proposal/inference separation and stale-source review status.
- Minimal consistent context with exact UTF-8 budgets and freshness checks.
- Durable processing runs, span-backed candidates, normalization and conservative reconciliation.
- Atomic multi-slot publication, bounded retries and persisted provider output.
- Automatic fact discovery and context with deduplicated required supporting evidence and compact processing readiness.
- Transactional schema-1/2/3 upgrades to schema 4 through an explicit migration registry.
- Opt-in BM25/dense/RRF retrieval diagnostics and stream-neighborhood evidence expansion.
- BM25 as the simple canonical candidate ranker, with lexical and lexical+BM25 RRF retained only for explicit evaluation.
- Deterministic bounded candidate prioritization, exact citation identity, duplicate collapse and an internal inspectable decision plan consumed mechanically by rendering.
- Exact byte budgets, exact token limits only with an injected tokenizer, explicitly estimated-token limits, and retrieval-to-context diagnostics.
- Structured candidate time/qualifiers and a local Inspector for provenance and correction.
- TypeScript contracts, compiled JavaScript exports, tests and runnable examples.

There are no production npm dependencies or required external services. SQLite is the first embedded adapter, not a fixed product boundary.

## Embedding in a host (desktop, browser, mobile)

The root entry imports no Node built-ins. On Node, pass a filename; elsewhere inject a
synchronous SQLite driver (a sql.js adapter ships at `recanta-dev/sqljs`). Documents are
retained by stable identity with content hashes, deleted/restored/invalidated through a
versioned ledger, and recalled against a story-position boundary. Knowledge exports as
immutable, checksummed, per-row JSON artifacts that a host syncs by any transport and
restores on another device without a model call; the SQLite database is a rebuildable
device-local cache. See [host contract](docs/host-contract.md),
[persistence and synchronization](docs/persistence-and-sync.md) and
[compatibility](docs/compatibility.md). Node-only surfaces (Inspector, file artifact
store) live at `recanta-dev/node`.

## Development quickstart

Requires a supported Node 24 runtime, at least 24.12.0, and npm.

```bash
npm ci
npm run dev-check
npm run demo
npm run demo:memory
```

The demo creates and removes a temporary database. It persists a failed action observation, checks dependency invalidation, closes and reopens the store, and verifies the evidence/change feed.

## Local Inspector

Run npm run inspector -- --demo for an ephemeral browser demo with current memory, evidence, revision history and correction/requery. See [P1 capabilities](docs/p1-capabilities.md) for database access, retrieval comparisons and fine-grained diagnostics.

## Example

After `npm run build`:

```js
import { SqliteEventStore } from './dist/src/index.js';

const store = new SqliteEventStore('./events.sqlite');
const access = {
  namespaceId: 'workspace',
  readScopes: ['project'],
  writeScopes: ['project'],
};

try {
  const receipt = store.ingest(access, {
    streamId: 'session',
    eventId: 'attempt-1',
    scopeId: 'project',
    sourceId: 'tool-result-1',
    sourceVersion: 1,
    subjectIds: ['migration'],
    kind: 'action_result',
    content: 'Migration failed because permission was denied.',
  });
  const result = store.search(access, {
    query: 'permission', scopes: ['project'], minVersion: receipt.version,
  });
  console.log(result.hits.map(hit => store.resolveCitation(access, hit.citation)));
} finally {
  store.close();
}
```

The access object must come from trusted host authentication. It is not a security boundary against callers who control the process or database file.

## Limitations

General temporal reasoning, background scheduling, semantic/generative compression, automatic summary hierarchies, persistent vector indexing, production reranking, retention/deletion and backup tooling are **not implemented**. Dense/hybrid retrieval, model extraction, LongMemEval diagnostics and stream neighborhoods remain experimental. Automatic extraction and reconciliation have a bounded direct-fact policy; unsupported or ambiguous input remains unresolved. No external host integration, MCP/framework adapter, live-model quality benchmark or production load qualification has been performed.

Source versions must increase; an older document revision is rejected or explicitly ignored, never applied. Stored events remain available as history; the event feed is not a ranked or current-state retrieval API. The synchronous implementation is intended for bounded embedded workloads and has not been performance qualified. Artifact synchronization is file-based and model-free but has not been exercised on a real mobile device; concurrent extraction on two devices for the same fact yields an explicit divergence report, not a merge.

See [the event-store contract](docs/event-store.md), [source retrieval](docs/retrieval.md), [fact memory](docs/memory.md) and [development commands](docs/development.md). Private design and progress are recorded in [AI context](internal/AI_CONTEXT.md) and [status](internal/status.md).

For product surfaces and the transport-neutral async client contract, see
[integration contract](docs/integration-contract.md). HTTP/OpenAPI and future MCP/framework
adapters live outside the core. The HTTP server/client is available from
the `recanta-dev/http` subpath; see [HTTP API](docs/http-api.md). MCP and framework
adapters are not shipped yet.

Low-level explicit context assembly is available through compileContext. Canonical automatic recall uses BM25 ranking followed by deterministic bounded prioritization; detailed planning remains an Inspector/evaluation implementation detail. See [context contracts](docs/context.md). Pre-release breaking changes are recorded in [the migration notes](docs/migration.md).
