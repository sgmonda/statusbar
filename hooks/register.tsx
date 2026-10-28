import { atom, read, update } from 'claude-code'
import type { EngineInterface, ProcessRunResult, Register, RenderElement, Timer } from 'claude-code'

import type { Limit, Snapshot } from '../types'
import {
  barCellsFor,
  barOf,
  clockOf,
  hmsOf,
  labelOf,
  levelColor,
  MIN_BAR_CELLS,
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
 * Mark the worktree's name and the branch. The terminal is monospaced and draws
 * the glyphs; the desktop draws these drawings, which no font can change.
 */
const ICONS = {
  worktree: {
    glyph: '◫',
    alt: 'worktree',
    svg: '<path d="M1.75 4.25v8.5h12.5v-7H8L6.5 3.25H1.75z"/>',
  },
  branch: {
    glyph: '⎇',
    alt: 'branch',
    svg:
      '<circle cx="4.5" cy="3.5" r="1.75"/><circle cx="4.5" cy="12.5" r="1.75"/>' +
      '<circle cx="11.5" cy="5" r="1.75"/><path d="M4.5 5.25v5.5M11.5 6.75c0 3-7 2-7 4"/>',
  },
} as const
/** The icons' size in CSS pixels, about a cap height of the band's text. */
const ICON_PX = 12
/** A mid grey that reads as dimmed on a light or a dark theme alike. */
const ICON_COLOR = '#8b8b8b'
const svgOf = (shapes: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="${ICON_COLOR}" ` +
  `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`

/**
 * The empty part of a desktop bar: a translucent grey, faint on a light or a
 * dark theme alike, so the filled part stands out. No Box takes an opacity.
 */
const BAR_TRACK = 'rgba(128, 128, 128, 0.22)'

/** The line between the session facts and the usage row. */
const RULE = '─'
const RULE_FALLBACK_CELLS = 200

/**
 * The room around separators, bars and clocks. A proportional font (the desktop)
 * draws spaces narrow, so it takes more of them; a monospaced one (the terminal)
 * gives each a whole cell, so it takes fewer.
 */
const SPACING = {
  proportional: { separator: '   ·   ', air: ' ', minGap: 4 },
  monospaced: { separator: '  ·  ', air: '', minGap: 2 },
} as const

/**
 * Where the session runs, as git sees it. Three read-only git commands, each
 * written out in full: the repository's directories, the branch, the short sha.
 */
const git = async ($: EngineInterface, cwd: string): Promise<GitFacts | null> => {
  const init = { cwd, timeoutMs: 5_000 }
  const settle = (run: Promise<ProcessRunResult>) => run.catch(() => null)

  const dirs = await settle(
    $.process.run(
      ['git', '--no-optional-locks', 'rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel'],
      init,
    ),
  )
  if (dirs === null || dirs.exitCode !== 0) return null

  const [gitDir, commonDir, topLevel] = dirs.stdout.trim().split('\n')
  // symbolic-ref answers on a branch with no commits yet; rev-parse covers a detached HEAD.
  const [branch, sha] = await Promise.all([
    settle($.process.run(['git', '--no-optional-locks', 'symbolic-ref', '--short', '-q', 'HEAD'], init)),
    settle($.process.run(['git', '--no-optional-locks', 'rev-parse', '--short', 'HEAD'], init)),
  ])
  const ok = (r: ProcessRunResult | null) => (r?.exitCode === 0 ? r.stdout.trim() || undefined : undefined)

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
    // Only the main loop raises `turn.start`; a subagent's run raises none, so it never starts the clock.
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
    // Desktop already shows the model and context fill around the prompt.
    const showModel = e.surface !== 'desktop'

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

    const name = <Text key="name" bold color="warning">{place.name}</Text>
    const marked = (icon: keyof typeof ICONS, value: string | undefined, color: string) => {
      if (!value) return []
      const { glyph, alt, svg } = ICONS[icon]
      let mark = <Text key={`${icon}-icon`} dimColor>{glyph}</Text>
      // Only the desktop's table has Svg; the terminal keeps the glyph.
      if (e.surface === 'desktop') {
        const { Svg } = $.ui.resolve(e)
        mark = <Svg key={`${icon}-icon`} source={svgOf(svg)} alt={alt} width={ICON_PX} height={ICON_PX} />
      }
      return [
        <Text key={`${icon}-gap`}>{'  '}</Text>,
        mark,
        <Text key={`${icon}-air`}> </Text>,
        <Text key={`${icon}-name`} color={color}>{value}</Text>,
      ]
    }
    const head = place.isRepo
      ? [name, ...marked('worktree', place.worktree, 'claude'), ...marked('branch', place.branch, 'suggestion')]
      : [name]

    const limit = (l: Limit, cells: number) => {
      const [filled, empty] = barOf(l.percentUsed, cells)
      const left = remainingOf(l.resetsAt, now)
      const tail = [
        AIR,
        left ? <Text key="reset" dimColor> ↻ </Text> : null,
        left ? <Text key="left" dimColor>{figures(left)}</Text> : null,
        left ? AIR : null,
      ]
      if (e.surface === 'terminal') {
        return (
          <Text key={l.kind}>
            {label(labelOf(l.kind))}
            {AIR}
            <Text color={levelColor(l.percentUsed)}>{filled}</Text>
            <Text dimColor>{empty}</Text>
            {tail}
          </Text>
        )
      }
      // A proportional font draws █ and ░ as it likes; theme-coloured boxes look the same in any.
      // The cell count is only an estimate there, so the bar may shrink to the minimum
      // rather than push the clocks onto a second row.
      const run = (key: string, cells: number, color: string) =>
        cells > 0 ? <Box key={key} flexGrow={cells} width={0} height={1} backgroundColor={color} /> : null
      return (
        <Box key={l.kind} flexDirection="row" flexShrink={1}>
          <Text>
            {label(labelOf(l.kind))}
            {AIR}
          </Text>
          <Box key={`${l.kind}-bar`} flexDirection="row" width={cells} minWidth={MIN_BAR_CELLS} flexShrink={1}>
            {run('filled', [...filled].length, levelColor(l.percentUsed))}
            {run('empty', [...empty].length, BAR_TRACK)}
          </Box>
          <Text>{tail}</Text>
        </Box>
      )
    }

    const facts = (
      <Box key="facts" flexDirection="row" alignItems="center">
        {head}
        {showModel && snap.model ? <Text dimColor> · </Text> : null}
        {showModel && snap.model ? <Text>{snap.model}</Text> : null}
        {showModel && snap.contextPercent !== undefined ? (
          <Text dimColor> (ctx {Math.round(snap.contextPercent)}%)</Text>
        ) : null}
      </Box>
    )
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

    // On the desktop the bars give way first; the row wraps only once they are at their shortest.
    const isShrinkable = e.surface !== 'terminal' && cells > MIN_BAR_CELLS
    const usageRow = (
      <Box
        key="usage"
        flexDirection="row"
        flexWrap={isShrinkable ? 'nowrap' : 'wrap'}
        justifyContent="space-between"
        width="100%"
      >
        <Box key="left" flexDirection="row" flexWrap={isShrinkable ? 'nowrap' : 'wrap'} flexShrink={1}>
          {joined('left', leftOf(cells))}
        </Box>
        <Box key="right" flexDirection="row" flexShrink={0}>
          {joined('right', right)}
        </Box>
      </Box>
    )

    // A rule between the rows, as wide as the band. The terminal gives `─` one
    // cell, so a full count fits exactly. A proportional font (the desktop) draws
    // it wider by a measure no element reports, so there the rule runs long in a
    // Box out of the flow, as wide as it needs not to wrap, and its row clips it
    // at the edge: a truncated Text would end in an ellipsis.
    const ruleColumns = e.props.bodyColumns ?? RULE_FALLBACK_CELLS
    const ruleText = (cells: number) => <Text color="subtle" dimColor>{RULE.repeat(cells)}</Text>
    const rule =
      e.surface === 'terminal' ? (
        <Box key="rule" width="100%" height={1} overflow="hidden">
          {ruleText(ruleColumns)}
        </Box>
      ) : (
        <Box key="rule" position="relative" width="100%" height={1} overflow="hidden">
          <Text> </Text>
          <Box position="absolute" top={0} left={0} width={ruleColumns * 4}>
            {ruleText(ruleColumns * 2)}
          </Box>
        </Box>
      )

    // The session facts take a row of their own above, so a long branch never
    // pushes the usage row onto two lines, and that row keeps the whole width.
    return (
      <Box flexDirection="column" width="100%">
        {facts}
        {rule}
        {usageRow}
      </Box>
    )
  })
}
