<div align="center">

# 墨伴 · Writing Buddy

**在 Obsidian 里写长篇。提问、改写、审阅，改不改始终由你决定。**

[English](README.md) | 简体中文

[![Obsidian 1.4.5+](https://img.shields.io/badge/Obsidian-1.4.5%2B-7C3AED?style=flat-square)](#快速开始)
[![桌面与移动端](https://img.shields.io/badge/%E5%B9%B3%E5%8F%B0-%E6%A1%8C%E9%9D%A2%20%2B%20%E7%A7%BB%E5%8A%A8%E7%AB%AF-2F3437?style=flat-square)](#要求)
[![无遥测](https://img.shields.io/badge/%E9%81%A5%E6%B5%8B-%E6%97%A0-2F5E33?style=flat-square)](#隐私与你的数据)
[![MIT](https://img.shields.io/badge/license-MIT-6B7280?style=flat-square)](LICENSE)

</div>

带着上下文写，不用离开正文。墨伴把对话、写作工具和改动审阅放在稿件旁边。每一处改动都先给你看，是否写回正文由你决定。

<table>
  <tbody>
    <tr>
      <td><strong>提问</strong></td>
      <td>选中一段文字直接问。正文不会被修改。</td>
    </tr>
    <tr>
      <td><strong>改写</strong></td>
      <td>运行写作动作后先查看候选改动，再决定是否应用。中文内容会用逐字级 diff 展示变化。</td>
    </tr>
    <tr>
      <td><strong>由你掌控</strong></td>
      <td>如果生成期间原文已经发生变化，墨伴不会把结果强行写回。已应用的改动也只有在原位置仍然可以安全恢复时才能撤销。</td>
    </tr>
  </tbody>
</table>

## 怎么用

1. 从稿件开始。可以选中一段，也可以直接从当前笔记开始。
2. 提一个问题，或者运行一个写作动作。
3. 查看结果。只有你选择应用之后，正文才会改变。

## 上下文按任务来

每个对话都可以决定 AI 能使用多少稿件内容。这是墨伴自己的设置，和模型的思考强度是两回事。

| 模式 | AI 可以使用什么 |
|---|---|
| **Auto** | 墨伴根据任务决定需要多少上下文。它可以只使用附近内容，也可以在受控预算内继续读取稿件；如果任务确实需要完整覆盖，也可以使用整部稿件。 |
| **Full** | 整部稿件。 |
| **Low** | 只使用选区、附近上下文和当前笔记，不会读取其他文件。 |

无论使用哪种模式，哪些库内容可以进入上下文、实际读取哪些内容以及上下文预算，都由墨伴负责。连接不会拿到库路径、文件系统能力，也不能直接访问你的文件。

## AI 由你选

在 **设置 → 墨伴 → AI Connections** 中添加连接。每个对话都可以选择自己的连接。

选择服务商，填入密钥，再选择模型。墨伴支持常用 AI 服务商，也支持任意 OpenAI 兼容端点：

- **服务商：** OpenAI、Anthropic、Google、DeepSeek、OpenRouter、Mistral、Groq、Cerebras、Together AI、Fireworks AI、Perplexity、Hugging Face 和 SiliconFlow，使用你自己的 API 密钥。
- **Ollama：** 连接运行在你自己机器上的模型。墨伴不会启动或管理模型进程。
- **自定义 OpenAI 兼容端点：** 填入自己的 Base URL，需要时再提供 API 密钥。端点可以位于本机、局域网、远程服务器或自托管环境中，墨伴不依赖某一种特定后端。

## 指令与技能

- **项目指令：** `WritingBuddy/instructions/project.md` 用来保存整个项目都适用的写作要求，由你自己编写。
- **内置技能：** 插件自带八个写作任务，并保持只读。你可以在任意技能上添加自己的定制，也可以随时重置。
- **自建技能：** 你也可以创建自己的技能，并和其他自定义内容一起保存在库中。

指令和技能可以补充墨伴的内置规则，但不能获得编辑权限，也不能把正文里的内容变成命令。详见 [Writing skills](docs/SKILLS.md)。

## 隐私与你的数据

- **不需要墨伴账号。** 服务商或端点由你自己选择，并遵循它们各自的条款。
- **项目数据留在库里。** 对话、指令和技能都以普通文件的形式保存在 `WritingBuddy/` 下。
- **凭据只保存在这台设备上。** API 密钥和连接凭据不会写入会同步的库文件。
- **没有遥测和分析。**
- **什么会离开库：** 当你发送一轮对话时，墨伴会把选中的正文、你的指令，以及根据当前模式整理出的上下文发送给这个对话所使用的连接。没有发起请求时，不会发送这些内容。服务商或端点运营方各自适用自己的隐私和数据政策。

## 快速开始

1. 在 Obsidian 中打开 **设置 → 第三方插件 → 浏览**，搜索 **Writing Buddy**，然后选择**安装**。
2. 在 **第三方插件 → 已安装插件** 中启用 **Writing Buddy**。
3. 到 **设置 → 墨伴 → AI Connections** 添加一个连接。

更新和其他 Obsidian 插件一样，通过第三方插件机制提供。

## 要求

需要 Obsidian 1.4.5 或更高版本，桌面端和移动端都可以使用。

在移动端，服务商或端点必须能从当前设备访问。如果模型服务只监听另一台机器自己的回环地址，手机或平板无法连接它。

## 文档

- [AI Connections](docs/AI_CONNECTIONS.md)
- [Writing skills](docs/SKILLS.md)

## 源码说明

墨伴以 MIT 许可发布。开发工作在私有仓库中进行，这个公开仓库提供发布产物和用户文档。

Obsidian 社区插件审核人员可以获得私有源码仓库的只读权限，用于审核。

## 许可

MIT，见 [LICENSE](LICENSE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
