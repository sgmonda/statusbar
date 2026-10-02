import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, Timer } from 'claude-code'

import type { Limit, Snapshot } from '../types'
import {
  barCellsFor,
  barOf,
  clockOf,
  hmsOf,
  labelOf,
  levelColor,
  modelLabel,
  mono,
  placeOf,
  remainingOf,
  sortLimits,
  usdOf,
  widthOf,
  type GitFacts,
} from './format'

const snapshot = atom({ plugin: 'statusbar', key: 'snapshot' } as const, null)
const activity = atom({ plugin: 'statusbar', key: 'activity' } as const, { agents: 0, tasks: 0, crons: 0 })
const turnStartedAt = atom({ plugin: 'statusbar', key: 'turnStartedAt' } as const, null)
const lastTurnMs = atom({ plugin: 'statusbar', key: 'lastTurnMs' } as const, 0)

/** Reset countdowns move by the minute, and a branch can change outside a turn. */
const TICK_MS = 60_000
/** The session and turn clocks redraw every second. */
const CLOCK_TICK_MS = 1_000
/** While a turn runs, the running subagents are counted every few seconds. */
const AGENTS_TICK_MS = 5_000

/**
 * The room around separators, bars and clocks. A proportional font (the desktop)
 * draws spaces narrow, so it takes more of them; a monospaced one (the terminal)
 * gives each a whole cell, so it takes fewer.
 */
const SPACING = {
  proportional: { separator: '   ·   ', air: ' ', minGap: 4 },
  monospaced: { separator: '  ·  ', air: '', minGap: 2 },
} as const

const git = async ($: EngineInterface, cwd: string): Promise<GitFacts | null> => {
  const run = (argv: string[]) =>
    $.process.run(['git', ...argv], { cwd, timeoutMs: 5_000 }).catch(() => null)

  const dirs = await run([
    '--no-optional-locks',
    'rev-parse',
    '--path-format=absolute',
    '--git-dir',
    '--git-common-dir',
    '--show-toplevel',
  ])
  if (dirs === null || dirs.exitCode !== 0) return null

  const [gitDir, commonDir, topLevel] = dirs.stdout.trim().split('\n')
  // symbolic-ref answers on a branch with no commits yet; rev-parse covers a detached HEAD.
  const [branch, sha] = await Promise.all([
    run(['--no-optional-locks', 'symbolic-ref', '--short', '-q', 'HEAD']),
    run(['--no-optional-locks', 'rev-parse', '--short', 'HEAD']),
  ])
  const ok = (r: typeof branch) => (r?.exitCode === 0 ? r.stdout.trim() || undefined : undefined)

  return { gitDir, commonDir, topLevel, branch: ok(branch), shortSha: ok(sha) }
}

const refresh = async ($: EngineInterface) => {
  const cwd = await $.session.cwd()
  const [facts, model, usage] = await Promise.all([
    git($, cwd),
    $.session.model().catch(() => undefined),
    $.session.usage(),
  ])

  const limits: Limit[] = usage.rateLimits.map(limit => ({
    kind: limit.kind,
    percentUsed: limit.percentUsed,
    resetsAt: limit.resetsAt ? Date.parse(limit.resetsAt) : undefined,
  }))

  const next: Snapshot = {
    place: placeOf(cwd, facts),
    model: model ? modelLabel(model) : undefined,
    contextPercent: usage.context.percent,
    costUsd: usage.cost?.usd,
    limits: sortLimits(limits),
    startedAt: usage.startedAt,
  }
  await update($, snapshot, () => next)
}

const countAgents = async ($: EngineInterface) => {
  const agents = (await $.agent.list()).filter(agent => agent.status === 'running').length
  await update($, activity, current => (current.agents === agents ? current : { ...current, agents }))
}

export const register: Register = (on, options) => {
  const everywhere = options.surfaces === 'all'
  const showCost = options.showCost === true

  // The running turn's agent count; a reload drops it with the module, and the next turn starts its own.
  let agentsTimer: Timer | undefined
  const stopAgentsTimer = () => {
    agentsTimer?.cancel()
    agentsTimer = undefined
  }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    await update($, turnStartedAt, () => null)
    await refresh($)
    $.clock.every(TICK_MS, () => void refresh($).then(() => countAgents($)))
    $.clock.every(CLOCK_TICK_MS, () => $.ui.invalidate('ui.render'))
    return result
  })

  // Pushed by the engine after each turn and whenever a rate-limit window moves a point.
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    // A subagent's turn starts inside the main one: the main turn's clock keeps running.
    if ((await read($, turnStartedAt)) === null) {
      const startedAt = await $.clock.now()
      await update($, turnStartedAt, () => startedAt)
      stopAgentsTimer()
      agentsTimer = $.clock.every(AGENTS_TICK_MS, () => void countAgents($))
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined) {
      stopAgentsTimer()
      await update($, lastTurnMs, () => e.durationMs)
      await update($, turnStartedAt, () => null)
    }
    await countAgents($)
    return result
  })

  // The settings Stop hook's input is the one place that lists background work and scheduled wakeups.
  on('classic.Stop', async ($, e, next) => {
    const tasks = (e.background_tasks ?? []).filter(task => task.type !== 'subagent').length
    const crons = e.session_crons?.length ?? 0
    await update($, activity, current => ({ ...current, tasks, crons }))
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (!everywhere && e.surface !== 'desktop')) return next(e)

    const snap = await read($, snapshot)
    if (snap === null) return next(e)

    const [work, turnStart, lastTurn, now] = await Promise.all([
      read($, activity),
      read($, turnStartedAt),
      read($, lastTurnMs),
      $.clock.now(),
    ])

    const { Box, Text } = $.ui.resolve(e)
    const { place } = snap
    // Desktop already shows the repo, branch, model and context fill around the prompt.
    const showSessionFacts = e.surface !== 'desktop'

    // The terminal is monospaced already; elsewhere figures switch to monospace glyphs so they do not jitter.
    const figures = e.surface === 'terminal' ? (text: string) => text : mono
    const label = (text: string) => <Text bold dimColor>{text} </Text>
    const spacing = e.surface === 'terminal' ? SPACING.monospaced : SPACING.proportional
    // Bars and clocks get air on each side, beyond the label's own space.
    const AIR = spacing.air
    const fact = (key: string, name: string, value: string, { isDim = false, isClock = false } = {}) => (
      <Text key={key}>
        {label(name)}
        {isClock ? AIR : null}
        <Text dimColor={isDim}>{figures(value)}</Text>
        {isClock ? AIR : null}
      </Text>
    )

    const head = place.isRepo ? (
      <Text>
        <Text bold color="warning">{place.name}</Text>
        {place.worktree ? <Text dimColor> ▸ </Text> : null}
        {place.worktree ? <Text color="claude">{place.worktree}</Text> : null}
        {place.branch ? <Text dimColor> (</Text> : null}
        {place.branch ? <Text color="suggestion">{place.branch}</Text> : null}
        {place.branch ? <Text dimColor>)</Text> : null}
      </Text>
    ) : (
      <Text bold color="warning">{place.name}</Text>
    )

    const limit = (l: Limit, cells: number) => {
      const [filled, empty] = barOf(l.percentUsed, cells)
      const left = remainingOf(l.resetsAt, now)
      return (
        <Text key={l.kind}>
          {label(labelOf(l.kind))}
          {AIR}
          <Text color={levelColor(l.percentUsed)}>{filled}</Text>
          <Text dimColor>{empty}</Text>
          {AIR}
          {left ? <Text dimColor> ↻ </Text> : null}
          {left ? <Text dimColor>{figures(left)}</Text> : null}
          {left ? AIR : null}
        </Text>
      )
    }

    const facts = showSessionFacts ? (
      <Text key="facts">
        {head}
        {snap.model ? <Text dimColor> · </Text> : null}
        {snap.model ? <Text>{snap.model}</Text> : null}
        {snap.contextPercent !== undefined ? (
          <Text dimColor> (ctx {Math.round(snap.contextPercent)}%)</Text>
        ) : null}
      </Text>
    ) : null
    const isTurnRunning = e.props.isWorking && turnStart !== null

    const leftOf = (cells: number) => [
      ...snap.limits.map(l => limit(l, cells)),
      work.agents > 0 ? fact('agents', 'AGENTS', String(work.agents)) : null,
      work.tasks > 0 ? fact('tasks', 'TASKS', String(work.tasks)) : null,
      work.crons > 0 ? fact('crons', 'CRON', String(work.crons)) : null,
      showCost && snap.costUsd !== undefined ? fact('cost', 'COST', usdOf(snap.costUsd)) : null,
    ]
    // The clocks sit at the right edge, apart from the figures that change by the turn.
    const right = [
      fact('time', 'TOTAL TIME', hmsOf(now - snap.startedAt), { isClock: true }),
      // Between turns, the last one's length, dimmed: it is not running.
      isTurnRunning
        ? fact('turn', 'CURRENT', clockOf(now - turnStart), { isClock: true })
        : fact('turn', 'CURRENT', clockOf(lastTurn), { isDim: true, isClock: true }),
    ]

    const joined = (side: string, segments: (RenderElement | null)[]) =>
      segments
        .filter(s => s !== null)
        .flatMap((segment, i) =>
          i === 0 ? [segment] : [<Text key={`${side}-sep-${i}`} dimColor>{spacing.separator}</Text>, segment],
        )

    // The bars take what the line leaves free, so it fits on one row as long as it can.
    const fixed = widthOf(joined('left', leftOf(0))) + widthOf(joined('right', right)) + spacing.minGap
    const cells = barCellsFor(e.props.bodyColumns, fixed, snap.limits.length)

    const usageRow = (
      <Box key="usage" flexDirection="row" flexWrap="wrap" justifyContent="space-between" width="100%">
        <Box key="left" flexDirection="row" flexWrap="wrap">
          {joined('left', leftOf(cells))}
        </Box>
        <Box key="right" flexDirection="row">
          {joined('right', right)}
        </Box>
      </Box>
    )

    // Where the session facts show (the terminal), they take a row of their own above,
    // so the usage row reads the same on every surface and keeps the whole width.
    return facts === null ? (
      usageRow
    ) : (
      <Box flexDirection="column" width="100%">
        {facts}
        {usageRow}
      </Box>
    )
  })
}
