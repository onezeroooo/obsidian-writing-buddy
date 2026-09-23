# Manuscript knowledge (novel memory)

English | [简体中文](NOVEL_MEMORY.zh-CN.md)

Writing Buddy can keep a book's knowledge current as you write: what happened,
where things are, how people stand with each other, what each character
knows, and what you as the author have decided is true. Generation then draws
on that knowledge at the point in the story you are writing, without rereading
the whole manuscript for every request.

The engine behind it is Recanta, a private memory kernel that is embedded
into the plugin at build time together with SQLite compiled to WebAssembly,
so the same engine runs on desktop and on mobile and there is nothing to
install, download or update separately. Writing Buddy reaches it through one
adapter and owns everything a novel needs on top: what counts as manuscript
and canon, where in the story a sentence sits, whose point of view it belongs
to, and which of two disagreeing facts wins.

## What you do

**Build once.** Open a chapter of your manuscript and run *Build manuscript
knowledge*. The chapter's top-level folder becomes the manuscript scope;
sibling folders named like 设定 / 人物 / canon / world become author canon. Both
are recorded in `WritingBuddy/memory/novel/project.md`.
Building reads every chapter and canon note once, through the connection you
set as the default for new conversations. Without a default connection the book
is still set up, and knowledge synchronized from another device still works;
only reading new text needs a model.

**Building is slow and costs tokens.** Manuscript knowledge is experimental, and
the first build is the expensive part: every passage of about 3,000
characters is one model request, so a long novel is hundreds of requests,
a long wait and a large number of output tokens. On desktop six chapters
are read at a time; on a phone, or through a model on this machine, one. Before it starts, the
plugin measures the scope — chapters, canon notes, passages — and asks you
to confirm. While it runs, Settings → Project data and the line under the
conversation title show how far it is (chapter 3/30, passage 12/153) with a
*Pause*; *Pause building manuscript knowledge* is also a command. A pause lands at
the next passage and keeps everything already read, so *Resume* pays only
for what was never asked. Disabling the plugin pauses the same way. A build
that was paused, or interrupted by closing Obsidian, does not continue by
itself: reopening the vault shows a notice and a *Resume* in Settings, and
nothing is asked until you press it. Chapter updates after the first build
are small and run on their own.

**Then just write.** Every save is noticed, coalesced (a burst of saves is one
unit of work), and processed only for the parts that changed. Renames and
moves keep the chapter's identity. Deleting a chapter retires its knowledge;
putting it back brings the knowledge back without a model. Applying an AI
candidate writes the file, and the file is processed like any other edit; a
candidate you did not apply is never remembered.

**When something goes wrong.** A quiet line under the conversation title says
*Building*, *Updating this chapter* or *Some chapters could not be processed*
with a *Retry*. *Rebuild manuscript knowledge* (a command, and a button in
Settings → Project data) throws away the local index and rebuilds it from
the portable files. There is no dashboard and nothing to approve.

**Whole-manuscript analysis is a separate operation.** The Composer's Context
choice is *Auto* or *Low*. To ask a question of the entire book, write it
in the Composer and run *Analyze whole manuscript (Full)*; an Auto turn that
finds it needs complete coverage still offers to continue that way.

## What a turn receives

A generation composes, in this order: your selection and its surroundings,
the active chapter, relevant author canon, story-position-safe knowledge from
the book, and targeted raw passages when the knowledge needs support. The
book's knowledge arrives as one evidence item, grouped by kind:

| Kind | Meaning | Source |
|---|---|---|
| Author corrections | What you explicitly corrected | your correction notes |
| Author canon | What you decided is true | canon folders |
| Current narrative state | Where things stand as of this point | manuscript |
| Manuscript events | What happened, in story order | manuscript |
| Relationship trajectory | How two people stand, and how that changed | manuscript |
| Threads | Open and closed plot threads | manuscript |
| Point-of-view knowledge | What the current chapter's character knows or believes | manuscript |
| Derived observations | Lower-confidence inferences | derived scope |

Two boundaries always hold. **Position:** knowledge from later in the story
than the place you are writing is withheld by the engine itself — a key that
moves in chapter twenty-two is still in its box while you write chapter
twenty-one. Within a chapter, the boundary is the chunk your cursor is in.
**Point of view:** what a character knows or believes is returned only when you
are writing that character's chapter; another character's private knowledge,
and a lie told to someone else, stay hidden. A lower kind that disagrees with a
higher one about the same thing is reported as a contradiction next to the
higher one; canon is never overwritten by what the manuscript happens to say,
and an explicit correction outranks canon.

A fact the manuscript states in several chapters is one fact with several
positions, so a relationship that turns and turns back reads as
`信任 → 猜疑 → 信任`. Editing an early chapter so that it no longer states a
fact retires that chapter's support; a later chapter that still states it keeps
it alive.

## Where things live

| Location | What | Synced |
|---|---|---|
| `WritingBuddy/memory/novel/project.md` | the project manifest: manuscript scope, canon folders, bootstrap state, the engine that wrote the knowledge | yes |
| `WritingBuddy/memory/novel/sources/<id>.md` | one bundle per chapter or canon note: its identity, path, story order, point of view, the manuscript revision last processed, and — in fenced blocks — every Recanta artifact about it (source revisions, extraction runs, fact transitions, lifecycle events) | yes |
| `WritingBuddy/memory/novel/corrections/<id>.md` | your explicit corrections, bundled the same way | yes |
| `.writing-buddy-cache/novel/<book>/` | the local index: the engine database, what is loaded, the pending queue, the last error | never |

The portable files are ordinary Markdown. They live inside the visible project
folder, so the Markdown synchronization you already use — Obsidian Sync with
its default settings, or anything else — carries them between devices; no
setting has to change. Each file starts with a `writing-buddy:` frontmatter
key that marks it as managed, names the engine, schema and artifact-format
versions, and is followed by a note that it is not for editing. The bundle
count grows with the number of chapters, not with the number of facts; an
edit adds blocks to its chapter's bundle. The blocks carry the extraction
inside, so knowledge that arrives from another device costs no model call;
each block carries Recanta's checksum, so a torn or hand-edited block is
skipped, never believed, and never replaces what this device already knows.
The files never contain credentials, machine paths or the location of the
local database; a test checks every file. Managed files are never manuscript,
never canon and never retrieved as context, and the plugin does not read its
own writes back as news. The local index is under the hidden cache root that
Obsidian Sync never uploads. Everything in it is disposable: delete the folder
and the next start rebuilds it from the bundles — without a model call. A
vault that still holds the earlier JSON layout is migrated once at start:
every JSON artifact is packed into its bundle, read back and verified, and
only then retired.

## Sync between devices

When another device receives synchronized files, in any order:

- a bundle's artifacts are applied as soon as their dependencies are present;
  one that arrives ahead of the bundle it depends on waits and is applied when
  that lands; a bundle delivered twice, or in any order, changes nothing;
- knowledge that arrives before its manuscript text is usable at once; when
  the text lands, the engine recognises the revision and asks no model;
- text that arrives before its knowledge waits a minute for the knowledge; if
  the knowledge does not come, the text is read here, and the two histories
  converge when the files meet, because identical work produces identical
  artifacts;
- a torn bundle, a foreign block, or one written by a newer engine is skipped
  and reported, never applied; it is read again when it changes;
- when two devices genuinely edited the same chapter at once, the text your
  sync tool keeps is the text memory follows: both histories reach both
  devices, and each device rebuilds its local index from the shared files the
  same way, so they arrive at the same knowledge.

## Recovery

| Situation | What happens |
|---|---|
| Plugin closed mid-processing | the queue is persisted before each item; the next start resumes it |
| Edits while the plugin was closed | start reconciles every tracked file's revision and queues the differences |
| Cache deleted or corrupt | rebuilt from the bundles on next start, no model call |
| Engine upgraded | an index written by another engine version is rebuilt from the bundles |
| A bundle corrupted by hand | its blocks are skipped; *Rebuild manuscript knowledge* rewrites every bundle from the engine |
| Some chapters failed | *Some chapters could not be processed* with *Retry*; the rest keep serving; text another device extracted heals it on arrival |
| The connection refuses (rate limit, model cooling down, server away) | nothing more is sent; the queue waits for the server's `Retry-After`, or 30 s doubling to 10 min, then continues by itself; Settings shows the wait |
| Suspected drift | *Rebuild manuscript knowledge* |

## Mobile

Nothing under `src/memory/` imports Node, Electron or Obsidian; a test enforces
it, and another opens the engine embedded in `main.js` under a browser-like
global with no Node modules at all. The lifecycle works in small asynchronous
steps between saves; noticing a save is synchronous and cheap, the work itself
happens later. Real-device qualification on iOS and Android — background
processing while writing, Obsidian Sync arrival on a second physical device,
cache loss on a phone — is still to be done by hand; see the release checklist.
