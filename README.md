# Status Bar

A session status bar for **Claude Code Desktop** (the Code tab). The `statusLine`
setting only runs in the terminal; this plugin draws the same kind of line above
the prompt in the desktop app:

```
my-repo ▸ fix-login (feat/oauth)
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
SESSION  ████░░░░  ↻ 02h 15m    ·   WEEK  ██████░░  ↻ 3d 04h    ·   AGENTS 2        TOTAL TIME  01:23:05    ·   CURRENT  00:42
```

And in the terminal, with `surfaces: all`:

```
my-repo ▸ fix-login (feat/oauth) · Opus 5.5 (ctx 42%)
───────────────────────────────────────────────────────────────────────────────────────────────────────
SESSION ████░░░░ ↻ 02h 15m  ·  WEEK ██████░░ ↻ 3d 04h  ·  AGENTS 2      TOTAL TIME 01:23:05  ·  CURRENT 00:42
```

- **Where you are**, on a row of its own above, so a long branch never pushes the rest onto two lines: the repository, the worktree when the session runs in one, and the branch (or `@<sha>` on a detached HEAD).
- **Usage limits**: your 5-hour session and weekly windows as bars that grow and shrink with the room the line leaves free, 4 to 20 cells (green below 50%, amber below 80%, red above), with the time until each resets. They appear on subscription plans once the first response has reported them.
- **Time**, at the right edge: how long the session has run (`TOTAL TIME`, as `HH:MM:SS`) and the turn's clock (`CURRENT`): live while Claude works, the last turn's length, dimmed, between turns.
- **Background activity**, only when there is some: running subagents (`AGENTS`), other background tasks such as shells, monitors and workflows (`TASKS`), and scheduled wakeups and cron tasks (`CRON`). Background tasks and wakeups are counted at the end of each turn.
- **Cost** (optional): the session's cost in USD, as `/cost` totals it.
- **In the terminal** (with `surfaces: all`) the top row adds the model and the context fill, which Claude Desktop already shows around the prompt; the usage row below reads the same as on the desktop, spaced tighter for a monospaced font.

Figures are drawn in monospace so the clocks do not jitter as they tick: Claude
Desktop's font is proportional and no element takes a font, so the bar uses
Unicode's mathematical monospace digits there (the terminal is monospaced already).

It refreshes after each turn and whenever a usage window moves a point, as the
engine reports it, plus once a minute so countdowns and branch changes stay current.
The session and turn clocks tick every second; while a turn runs, subagents are counted every five.

> **Early access.** This plugin is built on Claude Code's function-hooks API,
> which may change between releases. It needs Claude Code 2.1.286 or later.

## Install

From the official directory:

```
/plugin install statusbar@claude-plugins-official
```

Or straight from this repository:

```
/plugin marketplace add sgmonda/statusbar
/plugin install statusbar@sgmonda
```

## Settings

Open the config menu (`/config`) and find the plugin's rows, or set them under
`pluginConfigs.statusbar` in `~/.claude/settings.json`:

| Setting | Values | Default | What it does |
| --- | --- | --- | --- |
| `surfaces` | `desktop`, `all` | `desktop` | `desktop` draws the bar only in Claude Desktop; `all` also draws it in the terminal, above the prompt. |
| `showCost` | `true`, `false` | `false` | Adds the session's cost. |

The bar lives in the band above the prompt: collapse it with `ctrl+x ctrl+a`.

## What it runs, reads and sends

**It sends nothing out.** The plugin makes no network calls and writes no
files. Everything it reads is drawn in the bar on your own screen and kept in
the session's memory; it never leaves your machine.

**Programs it runs.** Only `git`, to show the repository, worktree and branch in
the terminal row: three read-only commands in the session's directory, with
`--no-optional-locks` so they never take a lock, each written out in full in
`hooks/register.tsx`, once when the session starts, after each turn and once a
minute:

| Command | Why |
| --- | --- |
| `git --no-optional-locks rev-parse --path-format=absolute --git-dir --git-common-dir --show-toplevel` | The repository's root, and whether the session is in a linked worktree. |
| `git --no-optional-locks symbolic-ref --short -q HEAD` | The current branch, also on a branch with no commits yet. |
| `git --no-optional-locks rev-parse --short HEAD` | The short commit hash, shown on a detached HEAD. |

**What it reads from Claude Code.** The session's usage figures (rate limits,
context fill, cost), its start time, working directory and model, and the
list of running subagents. It does not read the conversation's messages.

**Hooks.** Each one observes and passes the event on unchanged:

| Hook | What it does |
| --- | --- |
| `session.start` | Takes the first reading and starts the refresh timers. |
| `session.measure` | Refreshes the figures when Claude Code reports new usage. |
| `turn.start`, `turn.complete` | Start and stop the turn clock; recount subagents. |
| `classic.Stop` | Reads the count of background tasks and scheduled wakeups from the Stop event; changes nothing in it and affects no Stop hook of yours. |
| `ui.render` (`AbovePrompt`) | Draws the bar in the band above the prompt; draws nothing and passes the band on where the bar is off (`surfaces`) or a survey holds it. |

**The manifest's `types` field** names `types/index.d.ts`, the contract of the
values the plugin keeps in the session's state. Claude Code's
`claude plugin validate` holds the hooks module to it.

## Development

```bash
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

To load it in Claude Desktop while you work on it, add the folder to `env` in `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/this/repo" } }
```

Type-check with `tsc -p .` after running `/plugin-types` in a session (it writes
the API declarations to `.claude/types`).

The pure logic (bars, countdowns, clocks, git place, widths) lives in
`hooks/format.ts`; `hooks/register.tsx` holds the hooks and the drawing, and
`types/index.d.ts` the contract of the values the plugin keeps in `$.state`.

## License

MIT
