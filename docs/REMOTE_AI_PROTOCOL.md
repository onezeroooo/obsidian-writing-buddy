# Self-hosted AI Runtime protocol (V2)

Writing Buddy Self-hosted Runtime connections use V2 exclusively. V1 is removed and
there is no fallback or projectId field.

## Endpoints

- GET /v2/health
- GET /v2/capabilities
- POST /v2/chat
- POST /v2/rewrite
- POST /v2/cancel/{requestId}

The configured Base URL may be https://runtime.example.com or a LAN address such as
http://10.0.0.50:8791. A trailing version segment is stripped before the V2
path is appended.

## Authentication

Authenticated calls send exactly one credential header:

    Authorization: Bearer <token>

No Cloudflare Access headers, cookies, OAuth redirects, or embedded login are
used. The 获取 Token action opens BaseURL/auth/ in the system browser.

GET /v2/capabilities validates a pasted rart_ device token and may include an
auth object with expiresAt, daysRemaining and label. Null values and absent
expiry headers mean no expiry information, never expired.

Every authenticated response may include X-Token-Expires-At and
X-Token-Days-Remaining. Writing Buddy caches them from existing traffic; it does
not poll on a timer.

The distinct error codes token_expired, unauthorized and rate_limited are kept
through the adapter. Rate limiting is not automatically retried, and
Retry-After is shown when present.

## Request shape

Both chat and rewrite carry requestId, explicit Provider, explicit Model,
optional supported Effort, messages, and optional context documents or skill.
Rewrite also carries the selected passage. Connection identity is used only for
local routing and is never serialized to the Runtime.

The optional `skill` object is the single carrier for Writing Buddy's already
composed effective instructions. Its id may be a real task Skill or the
client-owned policy identity for a no-Skill chat. The Runtime does not resolve
Skills, read project instruction files, or combine instruction layers. It also
does not receive duplicate copies of shared selection, citation, review, or
candidate-output boilerplate in individual built-ins.
Direct and Local adapters map that composed text to the provider's native system
channel; evidence remains user content. Self-hosted Runtime is responsible for
honoring the same separation when it translates V2.

Context documents contain Vault-relative labels and supplied text. Absolute
filesystem paths and projectId are forbidden. The Runtime returns text or a
rewrite candidate through the existing SSE or NDJSON event contract. It never
edits the Vault.

The user-visible Context choices are ordered `Auto`, `Full`, `Low`. `Auto`
starts with the Agent loop; the Agent may synthesize from the bootstrap
context, use the controlled research tools, or request complete-corpus
execution when correctness requires every target unit to be covered. That
semantic choice belongs to the Agent; the client validates and executes it
within policy. `Full` requests
complete coverage of the current manuscript through client-side complete-corpus
orchestration; it is a distinct coverage intent, not a higher Context tier or a
deeper form of Auto. `Low` is local-only and does not enter the research loop.

`High` and `Medium` are no longer user-visible Context choices, although legacy
reports and compatibility plumbing may retain those values. None of these
client choices adds a Runtime request field or filesystem access, and they do
not change Effort.

Historical selection referents are encoded by the client as compact annotations
inside ordinary conversation messages, without file paths. Current selection
text remains in the existing chat documents or rewrite selection field.

Agent-led research is an application-level loop over ordinary V2 chat calls. In
one call the Agent may emit exactly one versioned JSON action between
`<WB_RESEARCH_PLAN>` and `</WB_RESEARCH_PLAN>`, with no other content:

```text
<WB_RESEARCH_PLAN>{"version":1,"action":"search","query":"natural-language semantic query"}</WB_RESEARCH_PLAN>
<WB_RESEARCH_PLAN>{"version":1,"action":"read","handle":"R1"}</WB_RESEARCH_PLAN>
<WB_RESEARCH_PLAN>{"version":1,"action":"readAround","handle":"S1","before":800,"after":800}</WB_RESEARCH_PLAN>
<WB_RESEARCH_PLAN>{"version":1,"action":"completeCorpus"}</WB_RESEARCH_PLAN>
<WB_RESEARCH_PLAN>{"version":1,"action":"synthesize"}</WB_RESEARCH_PLAN>
```

The block above shows the five alternative object shapes; a response contains
exactly one object, not all five. Version is always `1`, extra keys are rejected,
and `before` and `after` are optional integers in `0..4000` characters each.
`read` and `readAround` are meaningful only for opaque handles the client has
already issued. A first-turn `readAround` may therefore use an `S#` from the
deterministic bootstrap context; a made-up or unavailable handle fails closed.

- `search` carries one bounded natural-language semantic query. The client
  rejects extra keys and path-, URI-, filename-, or glob-shaped input, searches
  the eligible local Markdown corpus, and returns a bounded catalog of `R#`
  results. Archives remain excluded unless the writer explicitly requests them.
  Search results are candidates, not citeable evidence.
- `read` accepts only an `R#` issued in the same run. The client privately
  resolves it, rechecks eligibility and source revision, reads the located
  passage, and admits the returned `S#` evidence to the ledger.
- `readAround` accepts only a run-local `S#` with a source locator. The client
  clamps the requested before/after character counts, rechecks the source, and
  expands that same `S#` evidence item in place; it does not allocate another
  evidence handle or ledger item. Its success observation identifies the same
  handle as both `sourceHandle` and `evidence.handle`. For the active note it
  uses the current unsaved editor buffer.
- `completeCorpus` has no arguments and is exposed only to an Auto chat turn.
  It terminates bounded research and asks the client to run the existing frozen
  corpus workflow. Low, legacy High, and candidate-producing writing actions
  do not receive this capability.
- `synthesize` tells the client that no more evidence operations are needed.

Successful client observations have these exact shapes:

```text
{"action":"search","ok":true,"results":[{"handle":"R1","label":"source label","heading":null,"snippet":"bounded preview","truncated":false}],"exhausted":false}
{"action":"read","ok":true,"resultHandle":"R1","evidence":{"handle":"S1","label":"source label","truncated":false}}
{"action":"readAround","ok":true,"sourceHandle":"S1","evidence":{"handle":"S1","label":"source label","truncated":false}}
```

The action vocabulary is `search` / `read` / `readAround` / `completeCorpus` / `synthesize`; the
arguments contain opaque handles, never paths. Each next call receives only the
bounded tool observation plus evidence the client admitted. Final answers may
cite only the run's `S#` ledger. Malformed, over-budget, stale, ineligible, or
unknown-handle actions fail closed and never expand authority. All operations
share client-enforced action, backend-call, file-read, catalog, evidence,
character, deadline, and cancellation limits.

A failed `read` or `readAround` observation has the same `action`, `ok:false`,
the rejected `handle`, and a `reason`. The only reasons are `unknown-handle`,
`source-changed`, `source-unavailable`, and `budget-exhausted`. Observations are
JSON embedded in a client-generated user prompt; they do not create a new
Runtime request field.

The client may keep an action trace for live diagnostics, but it is ephemeral
run state. It is not serialized into Runtime V2, conversation metadata, or the
Vault.

This does not add HTTP endpoints or server-executed tools. Runtime V2 merely
transports the ordinary messages and context documents Writing Buddy assembled.
The Vault remains the source of truth; Writing Buddy owns all reads, provenance,
budgets, and safety, while the Agent owns semantic planning. The local retrieval
implementation is replaceable without changing V2. A complete-corpus run is
likewise client orchestration over ordinary chat calls and adds no filesystem or
project field.

## Events

Supported events are request.started, provider.selected, content.delta,
activity, usage, fallback, result, error, and done. Unknown events are ignored
for forward compatibility. A stream ending without done is terminated locally.

The result event contains either text for chat or replacement for rewrite, plus
optional provider, model, effort, usage, duration and attempt metadata.
