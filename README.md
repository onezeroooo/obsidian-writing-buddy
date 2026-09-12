<div align="center">

# Writing Buddy

**Long-form writing with AI inside Obsidian — ask, rewrite, review, and stay in control.**

English | [简体中文](README.zh-CN.md)

[![Obsidian 1.4.5+](https://img.shields.io/badge/Obsidian-1.4.5%2B-7C3AED?style=flat-square)](#quick-start)
[![Desktop and mobile](https://img.shields.io/badge/platform-desktop%20%2B%20mobile-2F3437?style=flat-square)](#requirements)
[![No telemetry](https://img.shields.io/badge/telemetry-none-2F5E33?style=flat-square)](#privacy-and-your-data)
[![MIT](https://img.shields.io/badge/license-MIT-6B7280?style=flat-square)](LICENSE)

</div>

Write with context, not around it. Writing Buddy keeps conversation, writing tools and revision
review next to the manuscript, and leaves every change to the text in your hands.

| | |
|---|---|
| **Ask** | Select a passage and ask about it. The note is not touched. |
| **Rewrite** | A writing action produces a candidate. You read the change — Chinese prose as a character-level diff — before anything is applied. |
| **Stay in control** | An edit whose source text moved while it was being generated is refused, not pasted over. An applied edit can be undone only while its target range is still safe to restore. |

## How it works

1. Work from the manuscript — select a passage, or start from the note you are in.
2. Ask a question, or run a writing action.
3. Review the result. Nothing changes in the manuscript until you apply it.

## Context that fits the task

Each conversation chooses how much of the manuscript the AI may see. This is a Writing Buddy
setting, separate from the model's own effort level.

| Mode | What the AI works from |
|---|---|
| **Auto** | The agent decides: synthesize from local context, research the manuscript through bounded reads, or ask for complete coverage when correctness needs it. |
| **Full** | The whole manuscript. |
| **Low** | The selection, its surroundings and the active note — never other files. |

In every mode Writing Buddy alone decides which vault material is eligible, performs the reads and
enforces the budget. No connection receives a path, a filesystem capability or direct vault access.

## Bring your own AI

Add connections under **Settings → Writing Buddy → AI Connections**; each conversation picks one.

Pick a provider, enter its key, and choose a model. Writing Buddy connects to popular AI providers
or to any OpenAI-compatible endpoint:

- **Providers** — OpenAI, Anthropic, Google, DeepSeek, OpenRouter, Mistral, Groq, Cerebras,
  Together AI, Fireworks AI, Perplexity, Hugging Face and SiliconFlow, each with your own key.
- **Ollama** — models running on a machine you control. Writing Buddy never starts or manages the
  model process.
- **Custom OpenAI-compatible** — your own Base URL and, if needed, a key. The endpoint can be local,
  on your LAN, remote or self-hosted; Writing Buddy does not require a specific backend.

## Instructions and Skills

- **Project instructions** — `WritingBuddy/instructions/project.md` holds guidance for the whole
  project, in your own words.
- **Bundled Skills** — eight writing tasks ship with the plugin and stay read-only. You can add a
  customization on top of any of them, or reset it.
- **Your Skills** — write your own; they live in the vault next to your customizations.

Instructions and Skills only add to the built-in rules. They cannot grant edit authority or turn
manuscript text into commands. See [Writing skills](docs/SKILLS.md).

## Privacy and your data

- **No Writing Buddy account.** You bring your own provider or endpoint, under its own terms.
- **Your project data lives in the vault.** Conversations, instructions and Skills are ordinary
  files under `WritingBuddy/`.
- **Credentials stay on this device.** API keys and connection credentials are never written to
  synced vault files.
- **No telemetry or analytics.**
- **What leaves the vault:** when you send a turn, the selected text, your instructions and the
  context assembled under the chosen mode go to that conversation's connection — nothing else,
  and nothing otherwise. Providers and endpoint operators apply their own privacy and data policies.

## Quick Start

1. In Obsidian, open **Settings → Community plugins → Browse**, search for **Writing Buddy** and
   choose **Install**.
2. Under **Community plugins → Installed plugins**, enable **Writing Buddy**.
3. Add an AI connection under **Settings → Writing Buddy → AI Connections**.

Updates arrive through Community plugins, like any other plugin.

## Requirements

Obsidian 1.4.5 or later, on desktop or mobile. On mobile, use a provider or endpoint that is reachable
from the device; a model server listening only on another machine's loopback address is not reachable.

## Documentation

- [AI Connections](docs/AI_CONNECTIONS.md)
- [Writing skills](docs/SKILLS.md)

## Source availability

Writing Buddy is distributed under the MIT license. Its development source is maintained in a
private repository; this public repository holds the distribution artifacts and user
documentation. Obsidian Community reviewers are granted read access to the private source
repository for review.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
