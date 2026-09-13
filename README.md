<div align="center">

# Writing Buddy

**Long form writing with AI inside Obsidian. Ask, rewrite, review, and stay in control.**

English | [简体中文](README.zh-CN.md)

[![Obsidian 1.4.5+](https://img.shields.io/badge/Obsidian-1.4.5%2B-7C3AED?style=flat-square)](#quick-start)
[![Desktop and mobile](https://img.shields.io/badge/platform-desktop%20%2B%20mobile-2F3437?style=flat-square)](#requirements)
[![No telemetry](https://img.shields.io/badge/telemetry-none-2F5E33?style=flat-square)](#privacy-and-your-data)
[![MIT](https://img.shields.io/badge/license-MIT-6B7280?style=flat-square)](LICENSE)

</div>

Write with context without leaving your manuscript behind. Writing Buddy keeps conversations, writing tools, and revision review alongside your work, while leaving every change to the text in your hands.

| | |
|---|---|
| **Ask** | Select a passage and ask about it. Your note stays untouched. |
| **Rewrite** | Run a writing action and review the proposed change before applying it. For Chinese prose, changes are shown as a character level diff. |
| **Stay in control** | Writing Buddy will not apply an edit if the source text has changed while the result was being generated. You can undo an applied edit only while the original range is still safe to restore. |

## How it works

1. Start from the manuscript. Select a passage, or simply work from the note you are in.
2. Ask a question or run a writing action.
3. Review the result. Your manuscript does not change until you choose to apply it.

## Context that fits the task

Each conversation controls how much of the manuscript the AI can work with. This is a Writing Buddy setting and is separate from the model's own effort level.

| Mode | What the AI can work with |
|---|---|
| **Auto** | Writing Buddy chooses what the task needs. It can use nearby context, read more of the manuscript within a controlled budget, or use the full manuscript when the task depends on complete coverage. |
| **Full** | The entire manuscript. |
| **Low** | The selection, nearby context, and the active note. Other files are not included. |

In every mode, Writing Buddy decides which vault content is eligible, performs the reads itself, and enforces the context budget. Connections never receive vault paths, filesystem capabilities, or direct access to your files.

## Bring your own AI

Add connections under **Settings → Writing Buddy → AI Connections**. Each conversation can use its own connection.

Choose a provider, enter your key, and select a model. Writing Buddy supports popular AI providers as well as any OpenAI compatible endpoint:

- **Providers:** OpenAI, Anthropic, Google, DeepSeek, OpenRouter, Mistral, Groq, Cerebras, Together AI, Fireworks AI, Perplexity, Hugging Face, and SiliconFlow, using your own API key.
- **Ollama:** connect to models running on a machine you control. Writing Buddy does not start or manage the model process.
- **Custom OpenAI compatible:** connect to your own Base URL and, when required, an API key. The endpoint can be local, on your LAN, remote, or self hosted. Writing Buddy does not depend on a specific backend.

## Instructions and Skills

- **Project instructions:** `WritingBuddy/instructions/project.md` contains guidance that applies across the whole project, written in your own words.
- **Bundled Skills:** eight writing tasks are included with the plugin and remain read only. You can add your own customization to any of them or reset it at any time.
- **Your Skills:** create your own Skills and keep them in the vault alongside your customizations.

Instructions and Skills extend Writing Buddy's built in rules. They cannot grant edit authority or make manuscript text behave like instructions. See [Writing skills](docs/SKILLS.md).

## Privacy and your data

- **No Writing Buddy account.** You connect your own provider or endpoint, subject to its own terms.
- **Your project data stays in the vault.** Conversations, instructions, and Skills are stored as ordinary files under `WritingBuddy/`.
- **Credentials stay on this device.** API keys and connection credentials are never written to synced vault files.
- **No telemetry or analytics.**
- **What leaves the vault:** when you send a turn, Writing Buddy sends the selected text, your instructions, and the context assembled for the chosen mode to that conversation's connection. Nothing is sent when you are not making a request. Your provider or endpoint operator applies its own privacy and data policies.

## Quick Start

1. In Obsidian, open **Settings → Community plugins → Browse**, search for **Writing Buddy**, and choose **Install**.
2. Under **Community plugins → Installed plugins**, enable **Writing Buddy**.
3. Add an AI connection under **Settings → Writing Buddy → AI Connections**.

Updates are delivered through Community plugins, just like any other Obsidian plugin.

## Requirements

Obsidian 1.4.5 or later, on desktop or mobile.

On mobile, the provider or endpoint must be reachable from the device. A model server that only listens on another machine's loopback address cannot be reached from your phone or tablet.

## Documentation

- [AI Connections](docs/AI_CONNECTIONS.md)
- [Writing skills](docs/SKILLS.md)

## Source availability

Writing Buddy is distributed under the MIT license. Development takes place in a private repository, while this public repository contains the distribution artifacts and user documentation.

Obsidian Community reviewers are granted read access to the private source repository for review.

## License

MIT. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
