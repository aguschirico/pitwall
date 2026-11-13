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
local main 2 behind origin/main · fetched 3m ago
  Waiting on you · 2
  1 · Decision  Search cache  4m ago
      worktree search · branch feat/search · PR #128 · CI ok · 4 ahead, 3 behind origin/main
      → pick between a Redis cache and an in-memory one
  2 · OK push  Desktop toasts  12m ago
      → 3 commits ready, wants your OK to push and open the PR
  Running · 1
  3 ● Docs refresh  now
      main checkout, on main · 1 commit not pushed
  Idle · 1
  4 ◌ Release notes  35m ago
  Closed · 1
  5 ○ feat/onboarding  2d ago
      worktree onboarding · 2 ahead, 6 behind origin/main · 5 uncommitted

blog
local main even with origin/main · fetched 1m ago
  Waiting on you · 1
  6 · Review  Draft on terminal multiplexers  20m ago
      → first draft done, wants a read before the edit pass
```

## What you get

- **Waiting on you** at the top: one line per front with the kind of wait (`Decision`, `OK push`,
  `Manual`, `Review`, `PR`), how long it has waited, and one line on what it needs. Open a row to see
  what the session last said, its last steps, and where to answer.
- **Running**, **Idle** and **Closed** below: what each front is doing now, plus PR and CI chips
  when the branch has a PR. Idle fronts have a session open that finished its turn and asks you
  nothing. Closed fronts have no session open: they stay a day (see Options), until their branch is
  merged or deleted, or until you press **✕ Close** on the row. Resuming one of its sessions brings
  it back.
- **Grouped by repository** when sessions run in more than one: the repos in alphabetical order,
  each in its own color with its own sections, worktrees under their main repo. With a single repo
  the panel is just the four sections.
- **Fronts, not sessions.** Sessions on the same repo and branch are one front, so picking a task up
  again in a new session keeps the same row. Sessions on `main` each get their own.
- **Git at a glance**: each row says which worktree its session is in (`worktree search`, or
  `main checkout`, with `on main` when it works on `main` itself), how far it is from
  `origin/main`, and what is left uncommitted; **▸ Git** lists the commits and files. A session on
  `main` also shows the commits it has not pushed yet. Under each repository's name, its local
  `main` against `origin/main`. The panel fetches `origin/main` itself, at most every 5 minutes per
  repository and never with a prompt (a fetch that would ask for a password or passphrase just
  fails, and the line says so), so "behind" means behind what is on the remote now.
- **Row buttons**, on a line under each row, open or closed: **↪ Go** brings that session's
  terminal tab to the front (Ghostty, iTerm2 and Terminal.app by tty; tmux, kitty and WezTerm
  through their remote control), so an OK push is one press away. **▸ Git** opens the branch below,
  **↗ Code** opens the folder in VS Code.
- **Answer from the coordinator**: every row has a number, and `/coordinate 1 pick B` sends your
  words, verbatim, to the session in row 1, waiting or running. A front keeps its number while it
  is on the panel, so a row that moves from waiting to running is still the one you read. You can also just ask in the chat: "tell the search one to go with Redis",
  "merge these two fronts", "call the feat/x front 'Desktop upgrade'", "dismiss the old one".
  Anything the coordinator writes for you is shown in a dialog first and only goes when you pick
  **Send**.

## What it never does

- **It does not relay approvals.** Commit, push, PR, merge, deploy, production changes and tool
  permissions are answered in the session itself. The panel tells you which session and what to
  answer. A session waiting on one of those takes no message through the panel at all, since any
  words could be read as the answer. Other messages may name them: "don't deploy, we are in a
  demo" is a warning, not an OK, and warnings are what sessions most need to pass along. If you
  want messages refused for the words alone, turn on the approval word check (see Options).
- **It does not act on its own.** Words you type with `/coordinate` go as yours. Words the
  coordinator's model drafts go only after you confirm them in Claude Code's own dialog, which
  neither the model nor another session can answer for you. The receiving session is told which
  of the two it got.
- **It treats other sessions' text as data.** Names, questions and waits that other sessions
  report reach the coordinator's model quoted and cut short, marked as never to be followed.
- It keeps its state on your machine, in `~/.claude/pitwall/` (or under `CLAUDE_CONFIG_DIR` when you set it, so each config sees only its own sessions). The one thing that leaves it is
  a short classification call to Claude at the end of each turn, the same way your session talks to
  Claude anyway.

## Install

In Claude Code:

```
/plugin marketplace add aguschirico/claude-plugins
/plugin install pitwall@aguschirico
```

It comes from [my marketplace](https://github.com/aguschirico/claude-plugins), next to my other
plugins. This repository is a marketplace of its own too (`/plugin marketplace add aguschirico/pitwall`,
then `pitwall@pitwall`), so installs made that way keep working.

Pick the **user** scope so it loads in every session. Sessions that were already open pick it up
after `/reload-plugins`.

Needs `git`. With an authenticated `gh` you also get PR and CI chips; without it they just do not
show. Built and tested on Claude Code 2.1.322 on macOS.

## Use

1. In the session you want as the coordinator, run `/panel`.
2. Click a row under **Waiting on you** to see why it waits.
3. Answer with `/coordinate <number> <text>`, or `/coordinate <number> go` to jump to that session.
   On an open question, **Answer here** writes `/coordinate <number> ` in the prompt for you.
   To tell several sessions the same thing, `/coordinate 1,3,4 <text>`, `/coordinate all <text>`
   or `/coordinate <repo> <text>`: each row takes it under its own rules, and the answer lists
   where it went and where it did not. With several repos on the panel, `all` means the rows of
   the repo the coordinator runs in, and `<repo>` is a header's name (`/coordinate blog ...`).
   Any row's number works, in any repo, not only the waiting ones.
4. Ask the coordinator about the fronts in plain words.

## Options

- **Refresh interval (seconds)**: how often the panel reads the other sessions. 5 by default,
  anything from 2 to 120 (a value outside that is held to the nearest end). Set it in Claude Code
  with `/plugin configure pitwall@aguschirico`, or from a shell:

  ```
  echo '{"refreshSeconds":"10"}' | claude plugin configure pitwall@aguschirico --values-stdin
  ```

  Then restart the session, or run `/reload-plugins`.
- **Approval word check**: which messages are refused when they mention push, PR, merge, deploy
  or prod, in English or Spanish, also when the word is hidden behind invisible characters,
  lookalike letters or spelled out letter by letter.
  - `off` (default): none. A word match cannot tell "push it" from "don't push yet", so it would
    stop the warnings too.
  - `drafted`: what the coordinator's model writes. Your `/coordinate` words go as you typed them.
  - `strict`: every message, yours included.

  Whatever you pick, a session waiting on an approval takes no message, and what the model drafts
  still needs your **Send** in the dialog. Set it the same way:
  `echo '{"approvalCheck":"strict"}' | claude plugin configure pitwall@aguschirico --values-stdin`.
- **Stuck after (minutes)**: a session waiting on you for longer than this shows
  `⏳ stuck 12m` in amber instead of its age, and its section says how many are stuck:
  `Waiting on you · 2 (1 stuck)`. 5 by default, `0` turns the badge off. Only waits count: a
  session that is running is never stuck. Set it the same way:
  `echo '{"stuckMinutes":"10"}' | claude plugin configure pitwall@aguschirico --values-stdin`.
- **Notify when stuck**: when a wait turns stuck, pitwall also raises a native notification
  through Claude Code's own channel (`preferredNotifChannel`: iTerm2, Ghostty, kitty, or the
  desktop app), once per wait, naming the session and what it needs. Waits that were already
  stuck when you opened the panel are not notified: you are looking at them. With two panels open,
  only one notifies. On by default; turn it off with
  `echo '{"stuckNotify":false}' | claude plugin configure pitwall@aguschirico --values-stdin`.
- **Keep closed fronts (days)**: how long a front with no open session stays under Closed, 1 to 7
  days, 1 by default. `✕ Close` hides one sooner, and any new activity in it brings it back:
  `echo '{"closedDays":"3"}' | claude plugin configure pitwall@aguschirico --values-stdin`.

## How it works

Two roles in one mod:

- **Reporter**, in every session. It writes `~/.claude/pitwall/reports/<sessionId>.json` as the
  session moves: running, waiting on a permission dialog, finished a turn. When a turn ends, it marks
  the session as waiting right away and then asks a small model (Haiku) to classify the last message:
  what kind of wait it is, the question, the options, a short recap and a topic. The topic names
  what the whole session is about, not the step of the moment: the model also sees your first
  prompt, Claude Code's title for the conversation and the branch, and a name is never swapped for
  one that only names a PR or issue (`Revisión PR #4002`). The topic also renames the session, unless you named it yourself or another session already has that name
  (sessions message each other by name). The coordinator keeps its own name.
- **Coordinator**, in the session where you ran `/panel`. Every 5 seconds (see Options) it reads the
  reports and Claude Code's own session registry, groups sessions into fronts, adds git and PR state,
  and draws the pane. When several sessions coordinate, whichever refreshes first writes a shared
  snapshot and the others read it, so `git` runs once per tick, not once per panel, and
  `git fetch origin main` once per repository every 5 minutes. PR and CI state
  is asked of GitHub at most once a minute per front, whatever the interval.

Sessions without the mod still appear, inferred from the registry and the tail of their transcript,
and marked `no report`. Their waits are never answered through the panel, because what they wait
on is only a guess.

The design notes are in [`docs/design.md`](docs/design.md).

### Next to a security plugin

An organization can install a managed plugin, often a security one, that runs ahead of every plugin
you install and answers permission requests itself. Pitwall's `classic.PermissionRequest` hook
then never runs, and Claude Code may say so:

```
pitwall: its classic.PermissionRequest hook was skipped. "<that plugin>" runs first and sent the event on past it.
```

Nothing is broken, and there is nothing to change on your side: pitwall cannot run before a
managed plugin, and it is not meant to. Permission waits still show, from the permission check
every tool call goes through. The one difference is in auto mode: that check cannot tell your
dialog from auto mode's classifier, so a call the classifier takes longer than 8 seconds to allow
can show as waiting for a permission until it starts running.

Claude Code shows that line in the conversation only when pitwall is loaded from a folder it
reloads as you edit (`claude --plugin-dir`, `CLAUDE_CODE_PLUGIN_DIRS`); installed from the
marketplace, it goes to the debug log (`claude --debug`) alone.

## Development

```
claude plugin test .       # 285 tests
claude plugin validate .   # what the engine would accept
claude --plugin-dir .      # try it without installing
```

## License

MIT
