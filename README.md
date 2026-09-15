<div align="center">

# Writing Buddy

**AI writing for long-form work in Obsidian. Think across your manuscript, rewrite with review, and keep every edit under your control.**

English | [简体中文](README.zh-CN.md)

[![Obsidian 1.4.5+](https://img.shields.io/badge/Obsidian-1.4.5%2B-7C3AED?style=flat-square)](#quick-start)
[![Desktop and mobile](https://img.shields.io/badge/platform-desktop%20%2B%20mobile-2F3437?style=flat-square)](#requirements)
[![No telemetry](https://img.shields.io/badge/telemetry-none-2F5E33?style=flat-square)](#privacy-and-your-data)
[![MIT](https://img.shields.io/badge/license-MIT-6B7280?style=flat-square)](LICENSE)

</div>

Writing Buddy is an Obsidian-native workspace for writing with AI without handing your manuscript over to it.

Ask questions about a passage. Rewrite or continue a scene. Check pacing or consistency across a long project. Bring your own model. Every generated change stays a candidate until you choose to apply it.

## Built for long-form writing

| | |
|---|---|
| **Work from the manuscript** | Select text, ask a question, rewrite a passage, or continue writing without leaving Obsidian. |
| **Think beyond one selection** | Stay local, let Writing Buddy research more of the manuscript, or use full manuscript coverage when the task requires it. |
| **Review before anything changes** | Writing actions produce candidates and diffs first. The manuscript changes only after you choose Apply. |
| **Use writing workflows, not just chat** | Built-in Skills cover rewriting, polishing, shortening, expanding, continuing, scene polish, pacing review, and project consistency. |
| **Make it yours** | Add project instructions, customize built-in Skills, create your own Skills, and choose model effort and context per conversation. |

## Context that matches the task

Writing Buddy separates manuscript context from the model's own reasoning effort.

| Context | What the AI can work with |
|---|---|
| **Auto** | Writing Buddy decides what the task needs. It can stay local, research more of the manuscript within a controlled budget, or use complete manuscript coverage when correctness depends on it. |
| **Full** | The complete eligible manuscript. |
| **Low** | The selection, nearby context, and the active note only. Other files are not included. |

Writing Buddy decides which Vault content is eligible, performs the reads itself, and enforces the context boundary. AI connections receive text, not Vault paths or filesystem access.

## Writing Skills

Writing Buddy includes eight writing-focused Skills:

| Skill | Purpose |
|---|---|
| **Rewrite** | Rewrite a selected passage while preserving its role in the scene. |
| **Polish** | Improve clarity, rhythm, and expression. |
| **Shorten** | Tighten prose without losing important content. |
| **Expand** | Develop a passage with useful detail. |
| **Continue** | Continue from the selected passage in context. |
| **Scene Polish** | Improve dialogue, transitions, scene flow, and showing versus telling where needed. |
| **Pacing** | Diagnose where a passage loses momentum and explain why. |
| **Consistency** | Check characters, continuity, setup, payoff, and other project-level facts against manuscript evidence. |

Built-in Skills stay release-owned, but you can add your own requirements to them. You can also create entirely new Skills and keep them in the Vault with the rest of your writing project.

Project instructions apply across the manuscript, so recurring preferences do not have to be repeated in every conversation. See [Writing Skills](docs/SKILLS.md).

## Your AI, your choice

Writing Buddy has no account and no bundled model. Add one or more AI Connections and choose the one each conversation should use.

Supported options include OpenAI, Anthropic, Google, DeepSeek, OpenRouter, Mistral, Groq, Cerebras, Together AI, Fireworks AI, Perplexity, Hugging Face, SiliconFlow, Ollama, and custom OpenAI-compatible endpoints.

A conversation can independently choose its Connection, Provider, Model, Effort, and Context. Writing Buddy never silently switches to another connection when the one you selected is unavailable.

See [AI Connections](docs/AI_CONNECTIONS.md) for setup and provider details.

## You stay in control of the text

Ask never edits the manuscript.

Rewrite and Continue return candidates first. Applying a change is a local operation inside Obsidian. If the source text changes while a result is being generated, Writing Buddy refuses to paste the result over the new text. Undo is also guarded and only restores the original range when it is still safe to do so.

For Chinese prose, rewrite review uses character-level diff so small wording changes remain easy to inspect.

## Privacy and your data

- **No Writing Buddy account.** You connect your own provider or endpoint, under its own terms.
- **Your project data stays in the Vault.** Conversations, project instructions, and Skills are ordinary files under `WritingBuddy/`.
- **Credentials stay on this device.** API keys and connection credentials are not written into synced Vault files.
- **No telemetry or analytics.**
- **What leaves the Vault:** when you send a turn, Writing Buddy sends the selected text, applicable instructions, and the context assembled for that request to the selected connection. Nothing is sent when you are not making a request.
- **Security reports:** see [SECURITY.md](SECURITY.md) for the private reporting path.

The provider or endpoint you choose has its own privacy and data policies.

## Quick Start

1. Open **Settings → Community plugins → Browse** in Obsidian.
2. Search for **Writing Buddy** and install it.
3. Enable Writing Buddy under installed Community plugins.
4. Add an AI connection under **Settings → Writing Buddy → AI Connections**.
5. Open a note and start from the manuscript.

Updates are delivered through Community plugins, like any other Obsidian plugin.

## Requirements

Obsidian 1.4.5 or later, on desktop or mobile.

On mobile, the selected provider or endpoint must be reachable from the device. A model server listening only on another machine's loopback address cannot be reached from a phone or tablet.

## Source and development

Writing Buddy is open source under the MIT license. This public repository contains the product source for each released version, the files needed to build it, user documentation, and the distributed plugin artifacts.

Development happens in a private workspace so internal AI context, experiments, unfinished plans, machine-specific configuration, and development history do not become part of the product repository. Each public release is exported through an explicit allowlist from a clean development tree.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
