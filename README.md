# pitwall

A Claude Code mod that keeps one view of every session open on your machine: what each one is
working on, which ones are waiting on you, and **why**, without reading their transcripts.

The name comes from Formula 1: the pit wall is where the team watches every car at once and talks
to the drivers over the radio, but the driver is the one who decides. Same rule here: you see every
session and can pass messages along, but approvals are always given in the session itself.

I usually have three or four sessions going at once: a feature in a worktree, a bug hunt, a long
task with several deploys. Everything I need to know is in there, buried in thousands of lines per
session, and rebuilding "where was I" every time I switch windows gets tiring. This panel sits next
to the chat of one session and keeps the latest picture of all the others.

```
api
  Waiting on you · 2
  1 · Decision  Search cache  4m ago
      branch feat/search · PR #128 · CI ok · 4 commits ahead · 3 behind main
      → pick between a Redis cache and an in-memory one
  2 · OK push  Desktop toasts  12m ago
      → 3 commits ready, wants your OK to push and open the PR
  Running · 1
  ● Docs refresh  now
      Edit: src/content/getting-started.md
  Paused · 1
  ○ feat/onboarding  2d ago
      branch feat/onboarding · 2 commits ahead · 5 uncommitted

blog
  Waiting on you · 1
  3 · Review  Draft on terminal multiplexers  20m ago
      → first draft done, wants a read before the edit pass
```

## What you get

- **Waiting on you** at the top: one line per front with the kind of wait (`Decision`, `OK push`,
  `Manual`, `Review`, `PR`), how long it has waited, and one line on what it needs. Open a row to see
  what the session last said, its last steps, and where to answer.
- **Running** and **Paused** below: what each front is doing now, plus PR and CI chips when the
  branch has a PR. Paused fronts stay for seven days, or until their branch is merged or deleted.
- **Grouped by repository** when sessions run in more than one: the repos in alphabetical order,
  each in its own color with its own sections, worktrees under their main repo. With a single repo
  the panel is just the three sections.
- **Fronts, not sessions.** Sessions on the same repo and branch are one front, so picking a task up
  again in a new session keeps the same row. Sessions on `main` each get their own.
- **Git at a glance**: commits over the main line, files changed, what is left uncommitted.
- **Go to session**: brings that session's terminal tab to the front (Ghostty, iTerm2 and
  Terminal.app by tty; tmux, kitty and WezTerm through their remote control).
- **Answer from the coordinator**: `/coordinate 1 pick B` sends your words, verbatim, to the first
  waiting session. You can also just ask in the chat: "tell the search one to go with Redis",
  "merge these two fronts", "call the feat/x front 'Desktop upgrade'", "dismiss the old one".
  Anything the coordinator writes for you is shown in a dialog first and only goes when you pick
  **Send**.

## What it never does

- **It does not relay approvals.** Commit, push, PR, merge, deploy, production changes and tool
  permissions are answered in the session itself. The panel tells you which session and what to
  answer. A session waiting on one of those takes no message through the panel at all, and no
  message anywhere goes out with an approval word in it, in English or Spanish, also when the word
  is hidden behind invisible characters, lookalike letters or spelled out letter by letter. A
  refusal costs you a window switch; a wrong relay could cost a push to production.
- **It does not act on its own.** Words you type with `/coordinate` go as yours. Words the
  coordinator's model drafts go only after you confirm them in Claude Code's own dialog, which
  neither the model nor another session can answer for you. The receiving session is told which
  of the two it got.
- **It treats other sessions' text as data.** Names, questions and waits that other sessions
  report reach the coordinator's model quoted and cut short, marked as never to be followed.
- It keeps its state on your machine, in `~/.claude/pitwall/`. The one thing that leaves it is
  a short classification call to Claude at the end of each turn, the same way your session talks to
  Claude anyway.

## Install

In Claude Code:

```
/plugin marketplace add aguschirico/pitwall
/plugin install pitwall@pitwall
```

Pick the **user** scope so it loads in every session. Sessions that were already open pick it up
after `/reload-plugins`.

Needs `git`. With an authenticated `gh` you also get PR and CI chips; without it they just do not
show. Built and tested on Claude Code 2.1.322 on macOS.

## Use

1. In the session you want as the coordinator, run `/panel`.
2. Click a row under **Waiting on you** to see why it waits.
3. Answer with `/coordinate <number> <text>`, or `/coordinate <number> go` to jump to that session.
4. Ask the coordinator about the fronts in plain words.

## How it works

Two roles in one mod:

- **Reporter**, in every session. It writes `~/.claude/pitwall/reports/<sessionId>.json` as the
  session moves: running, waiting on a permission dialog, finished a turn. When a turn ends, it marks
  the session as waiting right away and then asks a small model (Haiku) to classify the last message:
  what kind of wait it is, the question, the options, a short recap and a topic. The topic also
  renames the session, unless you named it yourself or another session already has that name
  (sessions message each other by name). The coordinator keeps its own name.
- **Coordinator**, in the session where you ran `/panel`. Every 15 seconds it reads the reports and
  Claude Code's own session registry, groups sessions into fronts, adds git and PR state, and draws
  the pane. When several sessions coordinate, whichever refreshes first writes a shared snapshot and
  the others read it, so `git` and `gh` run once per tick, not once per panel.

Sessions without the mod still appear, inferred from the registry and the tail of their transcript,
and marked `no report`. Their waits are never answered through the panel, because what they wait
on is only a guess.

The design notes are in [`docs/design.md`](docs/design.md).

## Development

```
claude plugin test .       # 199 tests
claude plugin validate .   # what the engine would accept
claude --plugin-dir .      # try it without installing
```

## License

MIT
