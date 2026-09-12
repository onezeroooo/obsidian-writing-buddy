# AI Connections

Writing Buddy has no account and no bundled model. You add one or more
connections under **Settings → Writing Buddy → AI Connections**, and each
conversation picks the one it uses. A connection is a provider plus whatever
that provider needs from you — usually an API key, sometimes an address.

## Adding a connection

**Add AI Connection** opens a searchable list of providers:

| Group | Providers |
|---|---|
| **Popular** | OpenAI, Anthropic, Google, DeepSeek, OpenRouter |
| **More providers** | Mistral, Groq, Cerebras, Together AI, Fireworks AI, Perplexity, Hugging Face, SiliconFlow |
| **Advanced** | Ollama, Custom OpenAI-compatible |

Pick a provider and the form asks only for what it needs:

- **Name** — prefilled with the provider's name; change it if you keep several
  connections to the same provider.
- **API Key** — for every hosted provider. Stored on this device only.
- **Base URL** — only for Ollama and Custom OpenAI-compatible, where the
  endpoint is yours to choose. Hosted providers use their own address; you do not
  enter one.
- **Model** — after **Test**, the models that provider offers are listed. Pin one,
  or leave all of them available and choose per conversation.

Several connections can coexist. The connection list shows each one by
provider — "DeepSeek · deepseek-chat", "Ollama" — together with its health.

## Providers

**OpenAI, Anthropic and Google** are reached through their own APIs with your own
key.

**DeepSeek, OpenRouter, Mistral, Groq, Cerebras, Together AI, Fireworks AI,
Perplexity, Hugging Face and SiliconFlow** are reached through their
OpenAI-compatible APIs at their official addresses. Models are read from the
provider's model listing; Perplexity, whose API has no listing, offers its
documented models directly. A model list always comes from the provider you
chose — never from another provider's catalogue.

**Ollama** is supported as a convenience for models running on a machine you
control. The default address is `http://127.0.0.1:11434`; change it if Ollama
runs elsewhere on your network. No key is needed. Writing Buddy never starts,
stops or manages Ollama.

**Custom OpenAI-compatible** covers everything else that speaks the OpenAI chat
API: a gateway you operate, a local server such as llama.cpp or vLLM, a hosted
service not in the list. Enter its base URL (usually ending in `/v1`) and a key
if the endpoint requires one. The endpoint can be local, on your LAN, remote or
self-hosted; Writing Buddy does not require a specific backend.

### On mobile

Use a provider or endpoint the device can reach. A model server listening only
on another machine's loopback address is not reachable from a phone or tablet.

## Choosing per conversation

The Composer offers, in order: Connection, Provider, Model, Effort and Context.
All five choices are per vault and per device. A conversation that has made its
own choice keeps it; otherwise the device's new-conversation default applies.
That default is never copied into synced conversation files.

No request is rerouted silently. If a conversation's connection is removed or
disabled, the Composer shows the missing selection and asks you to choose again
rather than falling back to another connection.

Context is a Writing Buddy setting, separate from the model's own effort level:

- **Auto** — the agent decides: synthesize from local context, research the
  manuscript through bounded reads, or ask for complete coverage when
  correctness needs it.
- **Full** — complete coverage of the current manuscript.
- **Low** — the selection, its surroundings and the active note only; never
  other files.

In every mode Writing Buddy alone decides which vault material is eligible,
performs the reads and enforces the budget. A connection receives text, not a
path, a filesystem capability or vault access. AI output is always a candidate;
only the local editing layer applies a rewrite, after checking the target range
is unchanged.

## Where things are stored

- **Connection settings and credentials** live on this device only, never in the
  vault. They are not synced, and are entered again after a fresh install.
- **Per-conversation choices** (connection, provider, model, effort, context) are
  stored per vault and per device, keyed by conversation. Deleting a conversation
  clears its choice; renaming moves it.
- **Conversation files** keep a safe record of which provider and model answered
  each turn, for history. They contain no credential and no full endpoint URL.

## Health

Connections are checked at startup, by the **Test** action and by ordinary
request success or failure; rendering the interface never triggers a request.
The header shows the overall state of enabled connections, and its popover lists
each one. Authentication failures and rate limits are reported as such;
interactive requests are not retried automatically.

## What this is not

Writing Buddy does not choose a provider for you, fall back to a second
connection, benchmark or compare models, or balance load across endpoints. Each
conversation talks to the connection you chose.
