# Writing Buddy

An Obsidian plugin for long-form writing: ask about a passage, generate rewrites, and review every change before it touches the manuscript.

English | [简体中文](README.zh-CN.md)

Writing Buddy (墨伴) keeps conversation, writing tools and revision review next to the manuscript,
and leaves the writer in control of every edit. Nothing is applied without being shown first, a
generation whose source text moved is refused rather than pasted over, and conversations live in the
vault as ordinary files. It talks to a self-hosted runtime, a direct API, or a local model server.

## Features

- Ask about a selected passage without changing the note.
- Generate rewrite candidates through an explicit writing action, then review Chinese prose changes
  as a character-level diff before applying them.
- Refuse a stale edit when the selection changed during generation, and undo an applied one only
  while the target range is still safe to restore.
- Keep conversations, project instructions and user-created Skills in the vault; packaged built-ins
  stay read-only.
- Choose context per conversation: agent-led **Auto**, complete-coverage **Full**, or local-only
  **Low**.
- Configure several self-hosted runtime, direct API and local connections, and pick one per
  conversation.

## Quick Start

Obsidian 1.4.5 or later. Desktop, or mobile with a self-hosted runtime or direct API connection —
local connections such as Ollama expect a server on the same machine.

1. In Obsidian, open **Settings → Community plugins → Browse**, search for **Writing Buddy** and
   choose **Install**.
2. Under **Community plugins → Installed plugins**, enable **Writing Buddy**.
3. Add an AI connection under **Settings → Writing Buddy → AI Connections** (see Configuration).

Updates arrive through Obsidian's Community plugins, like any other plugin.

## Configuration

Add connections under **Settings → Writing Buddy → AI Connections**. Each conversation then chooses its own
connection, provider, model, effort and context. A device-local preset supplies the selection for
new conversations, and once this device changes one, that choice is remembered without syncing
elsewhere.

**Context** is a client-owned control, separate from model effort:

| | |
|---|---|
| **Auto** | the agent decides — synthesize from local context, research with controlled tools, or request complete coverage when correctness needs it |
| **Full** | complete coverage of the manuscript through the complete-corpus workflow |
| **Low** | the selection, its surroundings and the active editor text, never cross-file research |

During research the agent chooses what to investigate next; Writing Buddy alone decides which vault
material is eligible, performs the reads, verifies revisions and enforces budgets and cancellation.
No backend receives a path, a filesystem capability, or direct vault access.

Local connections support Ollama and an OpenAI-compatible llama.cpp server (default
`http://127.0.0.1:8793/v1`, loopback only, API key optional). Writing Buddy never starts or manages
the model process.

## Instructions and Skills

Every turn composes one instruction stack: immutable product policy, the applicable bundled rules,
optional `WritingBuddy/instructions/project.md`, and at most one task Skill. Project instructions and
Skills are additive — they cannot weaken the policy, grant edit authority, or turn manuscript text
into commands.

Eight Skills ship in the bundle and are never written into the vault. Under **Settings → Writing Buddy →
Instructions and Skills** you can read a built-in, save an additive customization, reset it, or create your own.
See [Writing skills](docs/SKILLS.md).

## Privacy and network use

- No Writing Buddy account. You configure your own AI provider or self-hosted runtime; the plugin
  itself has no service behind it.
- Providers may require their own account, API key, quota or payment, and apply their own privacy
  and data policies. Direct API connections are available for OpenAI, Anthropic, Google and any
  OpenAI-compatible endpoint.
- When you send a turn, the selected manuscript text, your instructions and the context the plugin
  assembles from your vault (within the chosen context mode and budget) are sent to the connection
  you picked for that conversation. Nothing is sent otherwise.
- Local connections (Ollama, a loopback llama.cpp server) and self-hosted runtimes keep that traffic
  on your own machine or network.
- API keys and runtime credentials are stored on this device only, never in synced vault files.
- Writing Buddy has no telemetry or analytics and makes no network requests of its own.

## Documentation

- [AI Connections](docs/AI_CONNECTIONS.md)
- [Remote AI protocol](docs/REMOTE_AI_PROTOCOL.md)
- [Writing skills](docs/SKILLS.md)

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
