import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { mono, widthOf } from '../hooks/format'

/** Matches an element whose whole text is `text` in monospace glyphs, not one that merely holds it. */
const exactly = (text: string) => new RegExp(`^${mono(text)}$`, 'u')
import type { On, RenderElement, SessionUsage } from 'claude-code'

const NOW = Date.parse('2026-10-02T10:00:00Z')

const USAGE: SessionUsage = {
  startedAt: NOW - 83 * 60_000,
  context: { window: 200_000, tokens: 84_000, percent: 42 },
  rateLimits: [
    { kind: 'seven_day', percentUsed: 85, resetsAt: '2026-10-05T14:00:00Z' },
    { kind: 'five_hour', percentUsed: 30, resetsAt: '2026-10-02T12:15:00Z' },
  ],
  cost: { usd: 1.234 },
}

const BAND = {
  plugin: 'statusbar',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

/** Answers the engine calls the plugin makes, beneath it, as a session in a git checkout would. */
const fakeSession = (on: On) => {
  on('session.cwd', () => ({ value: '/src/app' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: USAGE }))
  on('clock.now', () => ({ value: NOW }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.reason === 'refusal' ? '' : e.answer }))
  on('agent.list', () => ({
    value: [
      { id: 'a1', description: 'Explore', type: 'Explore', status: 'running' },
      { id: 'a2', description: 'Review', type: 'general-purpose', status: 'running' },
      { id: 'a3', description: 'Done', type: 'Explore', status: 'completed' },
    ],
  }))
  on('classic.Stop', () => ({}))
  // The engine's own band, standing in for core when the plugin passes.
  on('ui.render', { component: 'AbovePrompt' }, () => h('Text', null, 'engine band') as RenderElement)
  on('process.run', (_, e) => {
    const args = e.argv.slice(2).join(' ')
    const stdout = args.startsWith('rev-parse --path-format')
      ? '/src/app/.git\n/src/app/.git\n/src/app\n'
      : args.startsWith('symbolic-ref')
        ? 'main\n'
        : 'abc1234\n'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
}

const measure = ($: Engine) =>
  $.session.measure({ context: USAGE.context, rateLimits: USAGE.rateLimits, changed: ['context'] })

test('on desktop, the checkout and branch sit above the limits; model and context are left to the app', async ($, on) => {
  fakeSession(on)
  await measure($)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /^app$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^main$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Opus/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined()

  const [session, week] = await ui.findAll({ type: 'Text', text: /^█+$/ })
  expect(session?.props.color).toBe('success')
  expect(week?.props.color).toBe('error')
  expect(await ui.find({ type: 'Text', text: exactly('02h 15m') })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: exactly('3d 04h') })).toBeDefined()

  // The checkout leads, then SESSION and WEEK; TOTAL TIME and CURRENT apart at the right, a wide separator within each side.
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts.indexOf('app')).toBeLessThan(texts.indexOf('SESSION '))
  expect(texts.indexOf('SESSION ')).toBeLessThan(texts.indexOf('WEEK '))
  expect(texts.indexOf('WEEK ')).toBeLessThan(texts.indexOf('TOTAL TIME '))
  expect(texts.indexOf('TOTAL TIME ')).toBeLessThan(texts.indexOf('CURRENT '))
  expect(texts.filter(t => t === '   ·   ')).toHaveLength(2)
  const drawn = await ui.drawn()
  expect(drawn).toMatchObject({ type: 'Box', props: { flexDirection: 'column' } })
  const usage = drawn.type === 'Box' ? drawn.children?.[2] : undefined
  expect(usage).toMatchObject({ type: 'Box', props: { justifyContent: 'space-between' } })
  expect(await ui.find({ type: 'Text', text: /\$/ })).toBeUndefined()
  await ui.unmount()
})

test('stays out of the terminal by default', async ($, on) => {
  fakeSession(on)
  await measure($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /SESSION/ })).toBeUndefined()
  await ui.unmount()
})

test('surfaces=all draws in the terminal too; showCost adds the cost', { options: { surfaces: 'all', showCost: true } }, async ($, on) => {
  fakeSession(on)
  await measure($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /^app$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^main$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ctx 42%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '$1.23' })).toBeDefined()
  await ui.unmount()
})

test('yields the band to a survey', async ($, on) => {
  fakeSession(on)
  await measure($)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, hasSurvey: true } })
  expect(await ui.find({ type: 'Text', text: /SESSION/ })).toBeUndefined()
  await ui.unmount()
})

test('shows the session clock and always the turn clock: live while running, the last one dimmed after', async ($, on) => {
  fakeSession(on)
  await measure($)

  const fresh = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await fresh.find({ type: 'Text', text: exactly('01:23:00') })).toBeDefined()
  expect((await fresh.find({ type: 'Text', text: exactly('00:00') }))?.props.dimColor).toBe(true)
  await fresh.unmount()

  await $.turn.start({ text: 'hi', turnId: 't1' })
  const working = await $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, isWorking: true } })
  expect((await working.find({ type: 'Text', text: exactly('00:00') }))?.props.dimColor).toBe(false)
  await working.unmount()

  await $.turn.complete({ answer: '', reason: 'answer', isAborted: false, durationMs: 42_000, turnId: 't1' })
  const done = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await done.find({ type: 'Text', text: exactly('00:42') }))?.props.dimColor).toBe(true)
  await done.unmount()
})

test('counts running agents, background tasks and scheduled wakeups', async ($, on) => {
  fakeSession(on)
  await measure($)

  const quiet = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await quiet.find({ type: 'Text', text: /AGENTS|TASKS|CRON/ })).toBeUndefined()
  await quiet.unmount()

  await $.classic.Stop({
    stop_hook_active: false,
    background_tasks: [
      { id: 'b1', type: 'shell', status: 'running', description: 'npm run dev' },
      { id: 'a2', type: 'subagent', status: 'running', description: 'Review' },
    ],
    session_crons: [{ id: 'c1', schedule: '0 9 * * 1-5', recurring: true, prompt: '/standup' }],
  })
  await $.turn.complete({ answer: '', reason: 'answer', isAborted: false, durationMs: 1000, turnId: 't1' })

  const busy = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const texts = (await busy.findAll({ type: 'Text' })).map(t => t.text)
  expect(texts).toContain(`AGENTS ${mono('2')}`)
  expect(texts).toContain(`TASKS ${mono('1')}`)
  expect(texts).toContain(`CRON ${mono('1')}`)
  await busy.unmount()
})

/** Each bar's width in cells, filled and empty runs together, in drawing order. */
const barWidths = async (ui: { findAll: (q: { type: string; text: RegExp }) => Promise<{ text: string }[]> }) => {
  const runs = (await ui.findAll({ type: 'Text', text: /^[█░]+$/ })).map(t => [...t.text].length)
  return [(runs[0] ?? 0) + (runs[1] ?? 0), (runs[2] ?? 0) + (runs[3] ?? 0)]
}

test('bars share out the free room: shortest when narrow, longest when wide, the line fitting between', async ($, on) => {
  fakeSession(on)
  await measure($)
  const at = (bodyColumns: number) => $.ui.mount({ ...BAND, surface: 'desktop', props: { ...BAND.props, bodyColumns } })

  const narrow = await at(60)
  expect(await barWidths(narrow)).toEqual([4, 4])
  await narrow.unmount()

  const wide = await at(400)
  expect(await barWidths(wide)).toEqual([20, 20])
  await wide.unmount()

  const fitted = await at(120)
  const [a, b] = await barWidths(fitted)
  expect(a).toBe(b)
  expect(a).toBeGreaterThan(4)
  expect(a).toBeLessThan(20)
  const tree = await fitted.drawn()
  const width = widthOf(tree.type === 'Box' ? tree.children?.[2] : undefined)
  expect(width).toBeLessThanOrEqual(120 - 4)
  expect(width).toBeGreaterThan(120 - 4 - 2)
  await fitted.unmount()
})

test('bars and clocks have a space of air on each side', async ($, on) => {
  fakeSession(on)
  await measure($)

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const session = await ui.find({ type: 'Text', text: /^SESSION / })
  expect(session?.text).toMatch(new RegExp(`^SESSION  [█░]+  ↻ ${mono('02h 15m')} $`, 'u'))
  const total = await ui.find({ type: 'Text', text: /^TOTAL TIME / })
  expect(total?.text).toBe(`TOTAL TIME  ${mono('01:23:00')} `)
  const turn = await ui.find({ type: 'Text', text: /^CURRENT / })
  expect(turn?.text).toBe(`CURRENT  ${mono('00:00')} `)
  await ui.unmount()
})

test('the session facts take a row of their own above the usage row, on every surface', { options: { surfaces: 'all' } }, async ($, on) => {
  fakeSession(on)
  await measure($)

  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const desktop = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const [termTree, deskTree] = [await terminal.drawn(), await desktop.drawn()]
  for (const tree of [termTree, deskTree]) {
    expect(tree).toMatchObject({ type: 'Box', props: { flexDirection: 'column' } })
    // A rule, then the usage row, laid out the same on both, fitting the band.
    expect(tree.type === 'Box' ? tree.children?.[1] : undefined).toMatchObject({ type: 'Box', props: { overflow: 'hidden' } })
    const usage = tree.type === 'Box' ? tree.children?.[2] : undefined
    expect(usage).toMatchObject({ type: 'Box', props: { justifyContent: 'space-between' } })
    expect(widthOf(usage)).toBeLessThanOrEqual(120)
  }
  await terminal.unmount()
  await desktop.unmount()
})

test('the terminal, monospaced, draws tighter: no extra air, narrower separators', { options: { surfaces: 'all' } }, async ($, on) => {
  fakeSession(on)
  await measure($)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  const session = await ui.find({ type: 'Text', text: /^SESSION / })
  expect(session?.text).toMatch(/^SESSION [█░]+ ↻ 02h 15m$/)
  expect((await ui.find({ type: 'Text', text: /^TOTAL TIME / }))?.text).toBe('TOTAL TIME 01:23:00')
  const separators = (await ui.findAll({ type: 'Text' })).filter(t => t.text === '  ·  ')
  expect(separators).toHaveLength(2)
  await ui.unmount()
})
