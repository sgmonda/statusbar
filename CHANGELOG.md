# Changelog

## 0.3.0

- The worktree and the branch each carry an icon instead of `▸` and parentheses, so one is never read as the other. On the desktop they are SVG drawings, the same whatever the font; the terminal draws `◫` and `⎇`.
- On the desktop the usage bars are boxes in the theme's colours instead of `█` and `░`, so they look the same whatever the font.
- On the desktop the bars shrink, down to 4 cells, before the clocks wrap onto a second row: the room a proportional font takes is only estimated.

## 0.2.0

- Claude Desktop shows the repository, worktree and branch too, on a row of their own above the usage row, so a long branch never pushes it onto two lines.
- A faint rule between the two rows, as wide as the band, on every surface.

## 0.1.0

First release.

- Session status bar above the prompt in Claude Code Desktop, optionally in the terminal too (`surfaces`).
- 5-hour session and weekly usage limits as bars that fit the free room, coloured by level, with time to reset.
- `TOTAL TIME` session clock and `CURRENT` turn clock, ticking every second; the last turn's length, dimmed, between turns.
- Running subagents, background tasks and scheduled wakeups, when there are any.
- Optional session cost (`showCost`).
- In the terminal, a row above with the repository, worktree, branch, model and context fill.
