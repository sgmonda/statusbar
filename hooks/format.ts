// Pure helpers: no `$`, so the tests exercise them directly.

import type { RenderNode } from 'claude-code'

import type { Limit, Place } from '../types'

export const BAR_CELLS = 6
/** The narrowest a bar draws while still telling levels apart, and the widest worth giving it. */
export const MIN_BAR_CELLS = 4
export const MAX_BAR_CELLS = 20

const pad = (n: number) => String(n).padStart(2, '0')

// Unicode's mathematical monospace digits and small letters: the one way to draw
// fixed-width figures where a surface's own font is proportional (the desktop),
// since no element takes a font.
const MONO_DIGIT_ZERO = 0x1d7f6
const MONO_SMALL_A = 0x1d68a

/** `02h 15m` → `𝟶𝟸𝚑 𝟷𝟻𝚖`: digits and a-z in monospace glyphs; anything else as is. */
export const mono = (text: string): string =>
  text.replace(/[0-9a-z]/g, c =>
    String.fromCodePoint(
      c <= '9' ? MONO_DIGIT_ZERO + (c.charCodeAt(0) - 48) : MONO_SMALL_A + (c.charCodeAt(0) - 97),
    ),
  )

const LIMIT_LABELS: Record<string, string> = {
  five_hour: 'SESSION',
  seven_day: 'WEEK',
  spend_limit: 'SPEND',
}

export const labelOf = (kind: string): string =>
  LIMIT_LABELS[kind] ?? kind.replace(/_/g, ' ').toUpperCase()

/** Theme key for a usage level: the same thresholds the terminal status line uses. */
export const levelColor = (percent: number): 'success' | 'warning' | 'error' =>
  percent >= 80 ? 'error' : percent >= 50 ? 'warning' : 'success'

/** Cells a tree's text takes, one per code point: the monospace glyphs and the bar blocks are one each. */
export const widthOf = (node: RenderNode | readonly RenderNode[] | null | undefined | false): number => {
  if (node === null || node === undefined || node === false) return 0
  if (typeof node === 'string' || typeof node === 'number') return [...String(node)].length
  if (Array.isArray(node)) return node.reduce((sum: number, child) => sum + widthOf(child), 0)
  return 'children' in node && node.children ? widthOf(node.children) : 0
}

/**
 * How wide each of `bars` bars draws when the rest of the line takes `fixed` of
 * `columns` cells: the free room shared out, within MIN and MAX; BAR_CELLS when
 * the surface has not said how wide it is.
 */
export const barCellsFor = (columns: number | undefined, fixed: number, bars: number): number => {
  if (bars === 0 || columns === undefined || !Number.isFinite(columns) || columns <= 0) return BAR_CELLS
  const share = Math.floor((columns - fixed) / bars)
  return Math.min(MAX_BAR_CELLS, Math.max(MIN_BAR_CELLS, share))
}

/** `[filled, empty]` block runs for a 0-100 percentage, `cells` wide. */
export const barOf = (percent: number, cells = BAR_CELLS): [string, string] => {
  const filled = Math.min(cells, Math.max(0, Math.round((percent / 100) * cells)))
  return ['█'.repeat(filled), '░'.repeat(cells - filled)]
}

/** `3d 04h`, `02h 15m` or `07m` until `resetsAt`; undefined once it has passed. */
export const remainingOf = (resetsAt: number | undefined, now: number): string | undefined => {
  if (resetsAt === undefined) return undefined
  const seconds = Math.floor((resetsAt - now) / 1000)
  if (seconds <= 0) return undefined
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${pad(h)}h`
  if (h > 0) return `${pad(h)}h ${pad(m)}m`
  return `${pad(m)}m`
}

/** Session windows first, then the week, then anything else the engine reports. */
export const sortLimits = (limits: readonly Limit[]): Limit[] => {
  const rank = (kind: string) => {
    const i = Object.keys(LIMIT_LABELS).indexOf(kind)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return [...limits].sort((a, b) => rank(a.kind) - rank(b.kind))
}

const trimSlashes = (path: string) => path.replace(/\/+$/, '')

export const baseName = (path: string): string => trimSlashes(path).split('/').pop() ?? path

export const dirName = (path: string): string => {
  const trimmed = trimSlashes(path)
  const i = trimmed.lastIndexOf('/')
  return i <= 0 ? '/' : trimmed.slice(0, i)
}

/** What `git rev-parse` and friends answered, raw; any field may be missing. */
export type GitFacts = {
  gitDir?: string
  commonDir?: string
  topLevel?: string
  branch?: string
  shortSha?: string
}

/**
 * The bar's head: `<repo> ▸ <worktree> (<branch>)`, `<repo> (<branch>)`, or
 * `<parent>/<dir>` outside a repository. Mirrors the terminal status line.
 */
export const placeOf = (cwd: string, git: GitFacts | null): Place => {
  if (git === null || git.gitDir === undefined) {
    return { name: `${baseName(dirName(cwd))}/${baseName(cwd)}`, isRepo: false }
  }

  const branch = git.branch ?? (git.shortSha ? `@${git.shortSha}` : undefined)
  const isWorktree = git.commonDir !== undefined && git.commonDir !== git.gitDir

  if (isWorktree) {
    const worktree = baseName(git.gitDir)
    return {
      name: baseName(dirName(git.commonDir!)),
      isRepo: true,
      worktree,
      branch: branch === worktree ? undefined : branch,
    }
  }

  return { name: baseName(git.topLevel ?? cwd), isRepo: true, branch }
}

/** `claude-opus-5-5` → `Opus 5.5`; anything already human-readable passes through. */
export const modelLabel = (model: string): string => {
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d+))?(?:-\d{8})?(\[1m\])?$/.exec(model)
  if (!match) return model
  const [, family, major, minor, longContext] = match
  const name = family!.charAt(0).toUpperCase() + family!.slice(1)
  return `${name} ${major}${minor ? `.${minor}` : ''}${longContext ? ' (1M)' : ''}`
}

/** `01:23:05`: how long the session has run, to the second (hours grow past 99). */
export const hmsOf = (ms: number): string => {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`
}

/** `00:42` or `01:02:03`: a running turn's clock, to the second. */
export const clockOf = (ms: number): string => {
  const seconds = Math.floor(Math.max(0, ms) / 1000)
  const h = Math.floor(seconds / 3600)
  const mmss = `${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`
  return h > 0 ? `${pad(h)}:${mmss}` : mmss
}

export const usdOf = (usd: number): string => `$${usd < 10 ? usd.toFixed(2) : usd.toFixed(1)}`
