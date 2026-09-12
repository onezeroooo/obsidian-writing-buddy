# AI Connections

Writing Buddy exposes one AI interface and routes each conversation through an
explicit user-configured Connection. The unified AI layer has three adapter
families: Local, Direct API, and Self-hosted Runtime.

## Terminology

- Connection: a user-configured AI access target.
- Backend: an internal implementation adapter.
- Provider: the model provider exposed through a Connection.
- Model: the model selected under that Provider.

Connection is not Provider or Model. Backend is not the user-visible
Connection. Self-hosted Runtime and Direct API are connection types, not providers.
The same provider and model may be used through several Connections with
different endpoints, credentials, or execution locations.

## Supported connection types

- Self-hosted Runtime uses RemoteAIBackend and discovers capabilities from the V2
  capabilities endpoint.
- Direct API uses DirectAPIBackend. It supports OpenAI, Anthropic, Google and
  OpenAI-compatible endpoints, using provider discovery or a configured model
  allow-list.
- Local supports Ollama and an unauthenticated OpenAI-compatible llama.cpp
  server. Ollama discovers `/api/tags`; llama.cpp checks `/health`, discovers
  `/v1/models`, and generates through `/v1/chat/completions`. The llama.cpp
  endpoint is restricted to loopback and defaults to
  `http://127.0.0.1:8793/v1`. Writing Buddy never starts or stops either server.

## Routing

The Composer exposes an explicit sequence: Connection, Provider, Model, Effort,
and Context. All five choices are per-vault and per-device. A complete local
override for the current session wins as a whole; otherwise the current device's
new-conversation default applies. The default is not copied into synced
conversation JSON, and schema <= 3 conversation preferences are never consulted.

No request is silently rerouted. RoutingAIBackend resolves `connectionId`
through BackendRegistry and rejects missing, removed, or disabled Connections.
Removing or disabling a Connection preserves the session's stable local override
and display snapshot, so the Composer shows the removed or disabled selection
and requires the writer to choose again instead of falling back to the default.

The user-visible Context choices appear in this product order:

- `Auto` starts with the Agent decision loop. The Agent may choose `synthesize`
  without a Vault search, use the controlled research tools, or request the
  existing complete-corpus workflow when correctness requires every target
  unit to be covered. The client validates and executes that choice.
- `Full` requests complete coverage of the current manuscript through the
  complete-corpus workflow. It is a separate coverage intent, not a higher
  Context tier or a deeper form of Auto.
- `Low` is local-only: it uses the supplied selection, surroundings, and active
  editor context without entering cross-file Agent research.

`High` and `Medium` are no longer user-visible Context choices. Historical
reports and legacy plumbing may retain those values for compatibility, but the
Composer does not offer them. Context and model reasoning effort remain
independent; this work does not change Effort, Connection, Provider, or Model
behavior.

Turn preflight, context assembly, bounded research, corpus-wide synthesis,
citations, and rewrite review use the same provider-neutral request shape. Each
backend translates it to its transport. Multi-call jobs freeze their Connection,
Provider, Model, Effort, history window, and composed instructions at the start;
there is no mid-run rerouting. AI responses remain candidates; only the local
Obsidian editing layer may apply a rewrite after exact-range validation.

The Agent owns semantic planning: it chooses the next semantic search, which
opaque result to read, whether more surrounding text is needed, and when the
available evidence is sufficient to synthesize. Writing Buddy owns eligibility,
handle resolution, every Vault read, source-revision checks, evidence admission,
provenance, budgets, cancellation, and safety. The backend receives only
client-supplied text, opaque run-local handles, and evidence IDs—never a Vault
path selector, filesystem capability, or server-side project directory. The
Vault is the source of truth. Retrieval is an internal replaceable component,
not part of a provider or Runtime contract.

The Agent action trace is kept only as ephemeral, in-memory diagnostics for the
current run. It is not persisted in conversation metadata or written to the
Vault. Full continues to use the retained client-side complete-corpus
orchestration over ordinary chat calls; it adds no remote filesystem capability.

## Persistence and secrets

Connection configs and credentials are device-local. Composer Connection,
Provider, Model, Effort and Context choices are stored separately per vault and
device, keyed by session id. That local override includes a stable Connection id
and display snapshot so a removed or disabled selection remains visible. Session
deletion clears its override, a conversation-file rename moves it to the new id,
and startup prunes stale overrides, including entries left by bulk deletion, for
session ids that no longer exist.

When older local preferences are loaded, legacy Context `High` and `Medium`
normalize to `Auto`; `Full` remains `Full`. Historical execution reports keep
their recorded detail, including a legacy mode value when present.

Conversation schema v4 omits top-level `preferences` entirely. Schema <= 3
preferences remain parseable so old files load, but they are ignored, stripped
on the next save, and never imported into device state. Assistant-message
`GenerationMetadata` remains synced as a safe historical execution snapshot of
the Connection display identity and provider/model/effort actually used. It
contains no credential or full endpoint URL; its display detail may retain a
safe route host, provider, or local-engine label.

The old singleton Runtime URL and token migrate once to the stable ID
conn_legacy_remote_runtime. A legacy device default may point to that migrated
Connection, but legacy conversation preferences do not participate in the
migration. Fresh installations begin with an empty, visible new-conversation
preset.

## Health

Connections are checked at startup, by the manual Test action, and by ordinary
request success or failure. Rendering never triggers a health request. The
header aggregates enabled Connection health and its popover shows each item.

## Self-hosted Runtime authentication

Self-hosted Runtime uses only V2 paths and exactly one Authorization Bearer header.
It never sends projectId or Cloudflare Access headers. A new Self-hosted Runtime
Connection has no prefilled URL; LAN URLs and old static LAN
tokens remain supported, and a public HTTPS URL may be entered when appropriate.

The 获取 Token action opens BaseURL/auth/ in the system browser. Writing Buddy
does not implement OAuth, callbacks, cookies, or an embedded login. Expiring
rart_ tokens are validated with the V2 capabilities endpoint. Expiry metadata
is cached from that response and from ordinary response headers. Missing expiry
metadata means unknown or non-expiring, never expired.

token_expired, unauthorized and rate_limited remain distinct. Ordinary
interactive adapter calls do not retry rate limits automatically, and
Retry-After is shown when supplied. The client-owned Full-corpus orchestrator
may perform its separate bounded, deadline-aware retry because abandoning a
long complete-coverage run has different semantics.

## Non-goals

This architecture does not implement automatic provider fallback, automatic
Connection failover, model benchmarking, load balancing, best-model selection,
or compare-model UI. It leaves room for future parallel targets without making
those decisions silently today.
