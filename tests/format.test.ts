import { describe, expect, test } from 'claude-code/testing'

import { barCellsFor, barOf, clockOf, hmsOf, levelColor, modelLabel, mono, placeOf, remainingOf, sortLimits, widthOf } from '../hooks/format'

describe('barOf', () => {
  test('rounds to the nearest of six cells and clamps', () => {
    expect(barOf(0)).toEqual(['', '░'.repeat(6)])
    expect(barOf(41)).toEqual(['██', '░'.repeat(4)])
    expect(barOf(42)).toEqual(['███', '░'.repeat(3)])
    expect(barOf(140)).toEqual(['█'.repeat(6), ''])
  })

  test('takes another width', () => {
    expect(barOf(34, 10)).toEqual(['███', '░'.repeat(7)])
  })
})

test('levelColor follows the 50/80 thresholds', () => {
  expect(levelColor(49.9)).toBe('success')
  expect(levelColor(50)).toBe('warning')
  expect(levelColor(80)).toBe('error')
})

test('remainingOf picks the two largest units, hours and minutes padded', () => {
  const now = 1_000_000
  expect(remainingOf(now + (3 * 86400 + 4 * 3600 + 59) * 1000, now)).toBe('3d 04h')
  expect(remainingOf(now + (2 * 3600 + 15 * 60) * 1000, now)).toBe('02h 15m')
  expect(remainingOf(now + 7 * 60 * 1000, now)).toBe('07m')
  expect(remainingOf(now - 1, now)).toBeUndefined()
  expect(remainingOf(undefined, now)).toBeUndefined()
})

test('sortLimits puts the session window before the week', () => {
  const sorted = sortLimits([
    { kind: 'other', percentUsed: 1 },
    { kind: 'seven_day', percentUsed: 2 },
    { kind: 'five_hour', percentUsed: 3 },
  ])
  expect(sorted.map(l => l.kind)).toEqual(['five_hour', 'seven_day', 'other'])
})

describe('placeOf', () => {
  test('outside a repository: <parent>/<dir>', () => {
    expect(placeOf('/Users/me/Developer/thing', null)).toEqual({ name: 'Developer/thing', isRepo: false })
  })

  test('a plain checkout', () => {
    const place = placeOf('/src/app/sub', {
      gitDir: '/src/app/.git',
      commonDir: '/src/app/.git',
      topLevel: '/src/app',
      branch: 'main',
    })
    expect(place).toEqual({ name: 'app', isRepo: true, branch: 'main' })
  })

  test('a linked worktree drops a branch that repeats its name', () => {
    const facts = {
      gitDir: '/src/app/.git/worktrees/fix-x',
      commonDir: '/src/app/.git',
      topLevel: '/src/wt/fix-x',
    }
    expect(placeOf('/src/wt/fix-x', { ...facts, branch: 'fix-x' })).toEqual({
      name: 'app',
      isRepo: true,
      worktree: 'fix-x',
      branch: undefined,
    })
    expect(placeOf('/src/wt/fix-x', { ...facts, branch: 'feat/y' }).branch).toBe('feat/y')
  })

  test('a detached HEAD shows its short sha', () => {
    const place = placeOf('/src/app', { gitDir: '/src/app/.git', commonDir: '/src/app/.git', shortSha: 'abc1234' })
    expect(place.branch).toBe('@abc1234')
  })
})

test('modelLabel humanizes model ids', () => {
  expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(modelLabel('claude-sonnet-5-5[1m]')).toBe('Sonnet 5.5 (1M)')
  expect(modelLabel('Opus 5.5')).toBe('Opus 5.5')
})

test('hmsOf counts the session as HH:MM:SS', () => {
  expect(hmsOf(5_000)).toBe('00:00:05')
  expect(hmsOf((83 * 60 + 5) * 1000)).toBe('01:23:05')
  expect(hmsOf(125 * 3600 * 1000)).toBe('125:00:00')
})

test('clockOf counts a turn to the second', () => {
  expect(clockOf(42_000)).toBe('00:42')
  expect(clockOf((12 * 60 + 5) * 1000)).toBe('12:05')
  expect(clockOf((3600 + 2 * 60 + 3) * 1000)).toBe('01:02:03')
})

test('mono swaps digits and small letters for their monospace glyphs', () => {
  expect(mono('02h 15m')).toBe('𝟶𝟸𝚑 𝟷𝟻𝚖')
  expect(mono('01:23:05')).toBe('𝟶𝟷:𝟸𝟹:𝟶𝟻')
  expect(mono('$1.23')).toBe('$𝟷.𝟸𝟹')
})

test('barCellsFor shares the free columns out within 4 and 20', () => {
  expect(barCellsFor(100, 60, 2)).toBe(20)
  expect(barCellsFor(100, 80, 2)).toBe(10)
  expect(barCellsFor(100, 95, 2)).toBe(4)
  expect(barCellsFor(undefined, 50, 2)).toBe(6)
  expect(barCellsFor(100, 50, 0)).toBe(6)
})

test('widthOf counts the text of a tree, one cell per code point', () => {
  const tree = { type: 'Box' as const, children: [{ type: 'Text' as const, children: ['SESSION ', '██░░', mono(' 02h')] }] }
  expect(widthOf(tree)).toBe(8 + 4 + 4)
})
