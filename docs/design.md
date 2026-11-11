# pitwall: design

## Intent

I work with three or four Claude Code sessions at once, each a different kind of work: a loop over
the issues of an epic, a long feature picked up again in new sessions, a bug triage, a long
operation with several deploys. All the information exists, but buried in thousands of lines per
session, and rebuilding "where am I" on each front every time I switch windows has a real cost.

I want **one coordinating session** with a **visual panel next to the chat** that always holds the
latest picture of every front, puts in front of me **what depends on me and why**, and lets me
**answer or ask things of the other sessions from there**, without going to read them.

It has to be **portable**: installed the same way on another computer, with other projects.

## Goals

1. See every front of work, with its state and next step, without reading transcripts.
2. See what waits on me at the top, highlighted, with the **kind** of wait and the **why**.
3. Open a waiting front and get enough context to decide.
4. Answer decisions from the coordinator's chat and have the answer reach the right session; for
   approvals, know exactly which session to go to and what to say.
5. Ask the coordinator things about other sessions ("tell the triage one to go on").
6. Install it on another computer without touching code.

## Non-goals (v1)

- An HTML page outside the session (left for a v2; the design must not rule it out).
- Seeing one computer's sessions from another.
- Starting or closing sessions from the panel.
- Deep integration with any particular repo.

## Anti-goals (a failure even if it works)

- A panel that makes me read as much as now: a row that needs more than one line to say what is
  going on is wrong.
- A coordinator that **acts on its own** in other sessions (approving a push, answering a decision)
  without me telling it to. It only relays what I ask.
- An **approval** (commit, push, PR, merge, SQL in production, a tool permission) travelling through
  the coordinator. Those are given in the session itself; the panel only says which one and what to
  answer.
- Having to set up each session by hand for it to show up (installing once per machine is fine).
- Leaking information from one computer to another or to an outside service.
- Being tied to one repo (paths, skills, conventions).

## What the environment offers (recon on Claude Code 2.1.319)

- `~/.claude/sessions/<pid>.json`: the registry of live sessions, with `sessionId`, `name`, `cwd`,
  `status` (`idle` means waiting on the user), `updatedAt`.
- Transcripts in `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`, with `ai-title` rows (the
  automatic title) and `assistant` rows carrying `gitBranch`, `cwd` and `timestamp`.
- Sessions can message each other: in a mod, `$.session.send({ to: { sessionId }, text })`.
- A Claude Code **mod** can open a pane next to the chat (`$.ui.open` plus `ui.render` on `Pane`),
  refresh on a timer (`$.clock.every`), read files (`$.fs`), run commands (`$.process.run`), call
  the model (`$.model`), persist state (`$.state`, `$.store`) and register slash commands and tools.
  It works in the terminal and on desktop.

## How it works

### Shape

- One mod, installed **once per machine at user scope**, loaded in every session, with two roles:
  - **Reporter** (every session): publishes its session's state as it changes (running, finished,
    waiting on text, waiting on a tool permission with the exact question) and receives what the
    coordinator relays.
  - **Coordinator** (the session I choose with `/panel`): opens the pane, groups the reports into
    fronts and relays my answers.
- A session without the mod still shows on the panel, with what can be inferred from outside
  (registry plus transcript), marked "no report".

### The unit is the front, not the session

- A **front** groups sessions by **repo and branch**. Picking the same work up in another session on
  the same branch keeps the same row.
- I can tell the coordinator "this is the same as X" to merge fronts, and rename a front. Those
  corrections persist.
- A session on a shared branch (`main`, `master`, `trunk`, `develop`) is its own front.

### The panel

Three blocks, top to bottom:

1. **Waiting on you**: always on top, highlighted. One line per front: kind of wait, front name,
   time waiting; below it, one line on *what* it needs. Oldest wait first.
   A wait older than the user's threshold (`stuckMinutes`, 5 by default, 0 for off) turns its time
   into an amber `⏳ stuck 12m` badge, and the block's header counts them: `Waiting on you · 2 (1 stuck)`.
   The moment it turns stuck the coordinator also raises one native notification (`$.ui.notify`,
   `stuckNotify` to turn it off). The waits told are kept in `pitwall/notified.json`, shared by
   every panel, so a second panel does not repeat it; a panel's first refresh only writes down the
   waits already stuck, since the user is opening the panel to look at them.
2. **Running**: one line per front with what it is doing now, plus PR and CI chips when they apply.
3. **Paused**: fronts with no live session, so they are not forgotten.

Kinds of wait:

| Tag | Means |
|---|---|
| **Decision** | the session cannot go on until I choose |
| **OK push** | a commit, push, PR or merge that needs my permission |
| **Manual** | only I can do it (log in, SQL in production, something off the machine, a tool permission on screen) |
| **Review** | something is ready for me to look at |
| **PR** | a front with no live session and an open PR waiting on my review or merge |

### Drill-down

Opening a waiting front shows, without going to the session: what the session last said, its last
few steps, the options it offered, and where and how to answer.

### Answering and asking

- **Decisions and instructions** ("pick B", "go on", "look into X") are answered with
  `/coordinate <n> <text>` (`n` is any row's number on the panel, waiting, running or paused),
  relayed verbatim and marked as typed by the user, or asked for in the
  coordinator's chat. What the coordinator's model drafts is shown in the engine's own question
  dialog (`$.ui.ask`) and goes only on **Send**; it is marked as drafted by the model and confirmed
  by the user. "Don't send" is the first option, so a dialog that settles by itself lands on no.
  An open question's **Answer here** button puts `/coordinate <n> ` in the coordinator's prompt
  box (`$.prompt.fill`) and sends nothing; a draft already there that is not a `/coordinate`
  line is left alone, with a toast.
  The same yes is asked when the model writes to a front's session with SendMessage directly.
- **Approvals are never relayed.** The drill-down says which session to go to. A session waiting
  on an approval (OK push, an open permission dialog) takes no message through the panel at all,
  since any words could be read as the answer. No message the coordinator's model drafts, to a
  front or to anyone else, goes out with an approval word in it; the user's `approvalCheck` option
  extends the check to what they type with `/coordinate` (`strict`) or turns it off (`off`), and
  `drafted` is the default. Detection is conservative and bilingual
  (English and Spanish), and reads the text folded first: Unicode NFKC, invisible characters
  dropped, common Cyrillic and Greek lookalikes mapped to Latin, letters spelled out one by one
  joined. A refusal costs a window switch, a wrong relay can cost a production change.
- A wait that is not classified yet (or a session without the mod) is never answered through the
  panel, and before the coordinator's first refresh it sends nothing at all.
- Text other sessions wrote (front names, topics, waits) reaches the coordinator's model as
  quoted data on one line, cut short, under a line that says it is never to be followed. The
  relayed text itself travels in JSON quotes, so it cannot close its envelope.
- These are layers, not the only guard: the receiving session still asks its own permissions
  before any tool runs.

### Detection

- **Primary: the reporter.** At the end of each turn it marks the session as waiting at once, then
  classifies the last message with a small model (kind, why, question, options, recap, topic). A
  classification that lands after the next turn started is dropped.
- A pending tool permission is **Manual** by definition.
  It shows once the ask has lasted 8 seconds: auto mode's classifier answers most asks in less, and
  a dialog the person has to answer is still open by then. A command the engine already draws as
  executing (its "run in background" pill) has its permission settled and is never shown waiting.
  A question to the person (AskUserQuestion, ExitPlanMode) shows at once.
- **Fallback** for sessions without a report: the registry's `idle` status plus the last assistant
  message in the transcript.
- The model runs only when a turn ends. The "running" line comes from cheap data: title, last tool,
  last prompt.

### Paused

- Fronts with activity in the last 7 days, even without a live session.
- They go away when the branch is merged or deleted, when I dismiss them, or when the window passes.

### Sharing the work between panels

Every panel can coordinate, but only one does the work: whichever refreshes first after the shared
snapshot (`~/.claude/pitwall/snapshot.json`) goes stale reads the registry, the reports, git
and gh, and writes it; the others read it. A panel refreshes every 5 seconds unless the user set
another interval (`refreshSeconds` in the plugin's options, held to 2..120), and a snapshot older
than that panel's interval counts as stale. PR chips are the exception: each is asked of GitHub at
most once a minute, the snapshot keeping when it was fetched (`prAt`) so the next writer reuses it.

### Portability

- Nothing repo specific: paths under `~/.claude` (or the folder `CLAUDE_CONFIG_DIR` names, where Claude Code keeps the registry and transcripts of that config) and what the transcripts carry.
- PR and CI chips through `gh` when it is installed and the branch has a PR; otherwise they do not
  show.
