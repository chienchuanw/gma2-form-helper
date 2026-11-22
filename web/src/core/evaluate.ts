import type { Graph, Mode, Point } from './model'

/**
 * Curve model calibrated against the grandMA2 3.9.60 graph editor
 * (docs/ma2-form-modes.md):
 *
 * - Each point's mode governs the segment from that point to the next; the last
 *   point connects back to the first across x = 1.
 * - linear: straight line. step_end: holds the start value, jumps at the end.
 *   step_start: jumps to the end value at the start.
 * - Consecutive spline segments form a chain solved as one C2 cubic spline in x.
 *   A chain ends at a non-spline neighbour, whose slope it takes (0 next to a
 *   step), or at a break: spline_break_start starts a new chain at its point and
 *   spline_break_end ends the chain at the end of its segment, with a natural
 *   (zero curvature) end condition. A graph made only of spline segments without
 *   breaks is one closed periodic spline. That last case matches MA only
 *   approximately; everything else matches within pixel accuracy.
 */

export type GraphWarning =
  /** A spline segment has (almost) zero width, i.e. a vertical jump; MA draws nothing for such a graph. */
  | 'splineJump'
  /** Breaks in an all-spline graph do not alternate start/end; MA draws such a graph erratically. */
  | 'unpairedBreak'

export interface GraphAnalysis {
  /** True when the preview can differ from MA by more than pixel accuracy. */
  approximate: boolean
  warnings: GraphWarning[]
}

/** Segments at most this wide in x (0.2 on the 0–100 scale) are a vertical jump, not a curve. */
const JUMP_WIDTH = 0.002 + 1e-9

type EndCondition = { clamp: number } | 'natural'

interface Compiled {
  /** Spline tangents (dy/dx) at the start and end of each segment; null for non-spline segments. */
  tangents: ([number, number] | null)[]
  analysis: GraphAnalysis
}

const cache = new WeakMap<Graph, Compiled>()

const isSplineMode = (m: Mode) => m === 'spline' || m === 'spline_break_start' || m === 'spline_break_end'

function compile(graph: Graph): Compiled {
  const cached = cache.get(graph)
  if (cached) return cached

  const pts = graph.points
  const n = pts.length
  const at = (k: number): Point => pts[((k % n) + n) % n]
  const X = (k: number) => at(k).x + Math.floor(k / n)
  const width = (k: number) => X(k + 1) - X(k)
  const rise = (k: number) => at(k + 1).y - at(k).y
  const mode = (k: number) => at(k).mode
  const isSpline = (k: number) => isSplineMode(mode(k)) && width(k) > JUMP_WIDTH

  const tangents: ([number, number] | null)[] = Array.from({ length: n }, () => null)
  const warnings: GraphWarning[] = []
  let approximate = false

  if (n >= 2) {
    if (pts.some((_, k) => isSplineMode(mode(k)) && width(k) <= JUMP_WIDTH)) warnings.push('splineJump')

    const hasBreak = pts.some((p) => p.mode === 'spline_break_start' || p.mode === 'spline_break_end')
    const allSpline = pts.every((_, k) => isSpline(k))

    if (allSpline && !hasBreak) {
      const m = solvePeriodic(pts.map((_, k) => width(k)), pts.map((_, k) => rise(k)))
      pts.forEach((_, k) => (tangents[k] = [m[k], m[(k + 1) % n]]))
      approximate = true
    } else {
      if (allSpline && !breaksAlternate(pts.map((p) => p.mode))) warnings.push('unpairedBreak')

      const startsChain = (k: number) =>
        isSpline(k) && (!isSpline(k - 1) || mode(k) === 'spline_break_start' || mode(k - 1) === 'spline_break_end')

      // A chain that runs into a non-spline segment takes its slope (a step is flat).
      const neighbourCondition = (k: number): EndCondition => {
        if (width(k) <= JUMP_WIDTH) return 'natural'
        if (mode(k) === 'linear') return { clamp: rise(k) / width(k) }
        if (mode(k) === 'step_start' || mode(k) === 'step_end') return { clamp: 0 }
        return 'natural'
      }

      for (let k0 = 0; k0 < n; k0++) {
        if (!startsChain(k0)) continue
        const segs = [k0]
        for (;;) {
          const last = segs[segs.length - 1]
          if (mode(last) === 'spline_break_end' || !isSpline(last + 1) || startsChain(last + 1) || segs.length >= n) break
          segs.push(last + 1)
        }
        const last = segs[segs.length - 1]
        const brokenStart = mode(k0) === 'spline_break_start' || mode(k0 - 1) === 'spline_break_end'
        const start: EndCondition = brokenStart ? 'natural' : neighbourCondition(k0 - 1)
        const end: EndCondition = mode(last) === 'spline_break_end' ? 'natural' : neighbourCondition(last + 1)
        const m = solveOpen(segs.map(width), segs.map(rise), start, end)
        segs.forEach((k, j) => (tangents[((k % n) + n) % n] = [m[j], m[j + 1]]))
      }
    }
  }

  const compiled = { tangents, analysis: { approximate, warnings } }
  cache.set(graph, compiled)
  return compiled
}

/** Breaks, read around the cycle, must alternate start, end, start, end… */
function breaksAlternate(modes: Mode[]): boolean {
  const seq = modes.filter((m) => m === 'spline_break_start' || m === 'spline_break_end')
  if (seq.length === 0) return true
  if (seq.length % 2 === 1) return false
  const first = seq.indexOf('spline_break_start')
  if (first === -1) return false
  const rotated = [...seq.slice(first), ...seq.slice(0, first)]
  return rotated.every((m, i) => m === (i % 2 === 0 ? 'spline_break_start' : 'spline_break_end'))
}

/** Slopes of an open C2 cubic spline through consecutive segments (widths h, rises dy). */
function solveOpen(h: number[], dy: number[], start: EndCondition, end: EndCondition): number[] {
  const n = h.length + 1
  const s = dy.map((d, k) => d / h[k])
  const A = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  const b = new Array<number>(n).fill(0)
  for (let k = 1; k < n - 1; k++) {
    A[k][k - 1] = h[k]
    A[k][k] = 2 * (h[k - 1] + h[k])
    A[k][k + 1] = h[k - 1]
    b[k] = 3 * (h[k] * s[k - 1] + h[k - 1] * s[k])
  }
  const setEnd = (row: number, other: number, cond: EndCondition, slope: number) => {
    if (cond === 'natural') {
      A[row][row] = 2
      A[row][other] = 1
      b[row] = 3 * slope
    } else {
      A[row][row] = 1
      b[row] = cond.clamp
    }
  }
  setEnd(0, 1, start, s[0])
  setEnd(n - 1, n - 2, end, s[n - 2])
  return solveLinear(A, b)
}

/** Slopes of a closed (periodic) C2 cubic spline over n segments. */
function solvePeriodic(h: number[], dy: number[]): number[] {
  const n = h.length
  const s = dy.map((d, k) => d / h[k])
  const A = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  const b = new Array<number>(n).fill(0)
  for (let k = 0; k < n; k++) {
    const prev = (k - 1 + n) % n
    A[k][prev] += h[k]
    A[k][k] += 2 * (h[prev] + h[k])
    A[k][(k + 1) % n] += h[prev]
    b[k] = 3 * (h[k] * s[prev] + h[prev] * s[k])
  }
  return solveLinear(A, b)
}

/** Gaussian elimination with partial pivoting; systems here are small (one row per point). */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r
    ;[A[c], A[p]] = [A[p], A[c]]
    ;[b[c], b[p]] = [b[p], b[c]]
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / A[c][c]
      if (f === 0) continue
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]
      b[r] -= f * b[c]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let r = n - 1; r >= 0; r--) {
    let v = b[r]
    for (let k = r + 1; k < n; k++) v -= A[r][k] * x[k]
    x[r] = v / A[r][r]
  }
  return x
}

/** How faithfully the preview of this graph matches MA, and what MA will struggle with. */
export function analyzeGraph(graph: Graph): GraphAnalysis {
  return compile(graph).analysis
}

/**
 * Value of a graph at time t (0–1, periodic).
 *
 * side = 'left' gives the value approaching t from below: at a jump it returns
 * the value before the jump, and at t = 1 the end of this cycle rather than the
 * start of the next.
 */
export function evaluate(graph: Graph, t: number, side: 'right' | 'left' = 'right'): number {
  const pts = graph.points
  const n = pts.length
  if (n === 0) return 0
  if (n === 1) return pts[0].y

  let u = t - Math.floor(t)
  if (side === 'left' && u === 0) u = 1
  let i = side === 'left' ? pts.findLastIndex((q) => q.x < u) : pts.findLastIndex((q) => q.x <= u)
  if (i === -1) {
    i = n - 1
    u += 1
  }

  const a = pts[i]
  const b = pts[(i + 1) % n]
  const width = b.x + (i + 1 === n ? 1 : 0) - a.x
  if (width <= 0) return b.y
  const f = (u - a.x) / width

  switch (a.mode) {
    case 'linear':
      return a.y + (b.y - a.y) * f
    case 'step_end':
      return a.y
    case 'step_start':
      return b.y
    default: {
      const tg = compile(graph).tangents[i]
      if (!tg) return a.y + (b.y - a.y) * f // zero-width spline segment: a jump
      return hermite(a.y, b.y, tg[0] * width, tg[1] * width, f)
    }
  }
}

function hermite(y0: number, y1: number, m0: number, m1: number, f: number): number {
  const f2 = f * f
  const f3 = f2 * f
  return (
    (2 * f3 - 3 * f2 + 1) * y0 + (f3 - 2 * f2 + f) * m0 + (-2 * f3 + 3 * f2) * y1 + (f3 - f2) * m1
  )
}

/** n + 1 evenly spaced samples over one cycle, x = 0 to x = 1 (the last one is the cycle's end). */
export function sampleGraph(graph: Graph, n: number): { x: number; y: number }[] {
  if (!(n >= 1)) throw new RangeError(`sampleGraph needs n >= 1, got ${n}`)
  return Array.from({ length: n + 1 }, (_, k) => {
    const x = k / n
    return { x, y: evaluate(graph, x, k === n ? 'left' : 'right') }
  })
}
