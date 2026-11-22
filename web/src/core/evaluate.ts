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
 *   spline_break_start starts a new chain at its point and spline_break_end ends
 *   the chain at the end of its segment; a chain's own break end is parabolic
 *   (m0 + m1 = 2 * secant), which leaves a corner. Every other chain end takes the
 *   slope of the neighbouring segment: its secant for a linear segment or for the
 *   first/last segment of a broken neighbour chain, 0 for a step, and a natural
 *   end next to a zero-width jump.
 *   A graph made only of spline segments without breaks is one closed periodic
 *   spline; that case matches MA only approximately.
 */

export type GraphWarning =
  /** A spline segment has (almost) zero width, i.e. a vertical jump; MA draws nothing for such a graph. */
  | 'splineJump'
  /** Breaks in an all-spline graph do not alternate start/end; MA draws such a graph erratically. */
  | 'unpairedBreak'
  /** The curve goes far past 0–100 (e.g. a spline next to a near-vertical segment); MA shoots off the chart too. */
  | 'overshoot'

export interface GraphAnalysis {
  /** True when the preview can differ from MA by more than pixel accuracy. */
  approximate: boolean
  warnings: GraphWarning[]
}

/** Segments at most this wide in x (0.2 on the 0–100 scale) are a vertical jump, not a curve. */
const JUMP_WIDTH = 0.002 + 1e-9

type EndCondition = { clamp: number } | 'natural' | 'parabolic'

/** One segment, from a point to the next (x0 may be followed by a wrap past x = 1). */
interface Segment {
  x0: number
  width: number
  y0: number
  y1: number
  mode: Mode
  /** Spline slopes (dy/dx) at both ends; only for spline segments wider than a jump. */
  m?: [number, number]
}

interface Compiled {
  segments: Segment[]
  analysis: GraphAnalysis
}

/** Keyed by Graph identity: graphs are treated as immutable (the editor makes a new one per change). */
const cache = new WeakMap<Graph, Compiled>()

const isSplineMode = (m: Mode) => m === 'spline' || m === 'spline_break_start' || m === 'spline_break_end'
const isBreakMode = (m: Mode) => m === 'spline_break_start' || m === 'spline_break_end'

function compile(graph: Graph): Compiled {
  const cached = cache.get(graph)
  if (cached) return cached

  const pts = graph.points
  const n = pts.length
  const wrap = (k: number) => ((k % n) + n) % n
  const at = (k: number): Point => pts[wrap(k)]
  const X = (k: number) => at(k).x + Math.floor(k / n)
  const width = (k: number) => X(k + 1) - X(k)
  const rise = (k: number) => at(k + 1).y - at(k).y
  const mode = (k: number) => at(k).mode
  const isJump = (k: number) => width(k) <= JUMP_WIDTH
  const isSpline = (k: number) => isSplineMode(mode(k)) && !isJump(k)

  const segments: Segment[] = pts.map((p, k) => ({ x0: p.x, width: width(k), y0: p.y, y1: at(k + 1).y, mode: p.mode }))
  const warnings: GraphWarning[] = []
  let approximate = false

  if (n >= 2) {
    if (pts.some((_, k) => isSplineMode(mode(k)) && isJump(k))) warnings.push('splineJump')
    const allSpline = pts.every((_, k) => isSpline(k))

    if (allSpline && !pts.some((p) => isBreakMode(p.mode))) {
      const m = solveSpline(segments.map((s) => s.width), pts.map((_, k) => rise(k)))
      segments.forEach((s, k) => (s.m = [m[k], m[(k + 1) % n]]))
      approximate = true
    } else {
      if (allSpline && !breaksAlternate(pts.map((p) => p.mode))) warnings.push('unpairedBreak')

      const startsChain = (k: number) =>
        isSpline(k) && (!isSpline(k - 1) || mode(k) === 'spline_break_start' || mode(k - 1) === 'spline_break_end')

      // A chain end that is not its own break takes the neighbouring segment's slope:
      // its secant (a linear segment or the edge of a broken chain), or 0 for a step.
      const neighbourCondition = (k: number): EndCondition => {
        if (isJump(k)) return 'natural'
        if (mode(k) === 'step_start' || mode(k) === 'step_end') return { clamp: 0 }
        return { clamp: rise(k) / width(k) }
      }

      for (let k0 = 0; k0 < n; k0++) {
        if (!startsChain(k0)) continue
        const segs = [k0]
        // startsChain(next) also covers a chain ending at a break_end segment.
        while (isSpline(segs.at(-1)! + 1) && !startsChain(segs.at(-1)! + 1) && segs.length < n) segs.push(segs.at(-1)! + 1)
        const last = segs.at(-1)!
        const start: EndCondition = mode(k0) === 'spline_break_start' ? 'parabolic' : neighbourCondition(k0 - 1)
        const end: EndCondition = mode(last) === 'spline_break_end' ? 'parabolic' : neighbourCondition(last + 1)
        const m = solveSpline(segs.map(width), segs.map(rise), [start, end])
        segs.forEach((k, j) => (segments[wrap(k)].m = [m[j], m[j + 1]]))
      }
    }
  }

  if (segments.some(overshoots)) warnings.push('overshoot')

  const compiled = { segments, analysis: { approximate, warnings } }
  cache.set(graph, compiled)
  return compiled
}

/** How far past 0–1 a spline must go to count as blowing up (ordinary spline overshoot near 0 or 1 is smaller). */
const OVERSHOOT = 0.5

function overshoots(seg: Segment): boolean {
  if (!seg.m) return false
  for (let i = 1; i < 32; i++) {
    const v = hermite(seg.y0, seg.y1, seg.m[0] * seg.width, seg.m[1] * seg.width, i / 32)
    if (v < -OVERSHOOT || v > 1 + OVERSHOOT) return true
  }
  return false
}

/** Breaks, read around the cycle, must alternate start, end, start, end… */
function breaksAlternate(modes: Mode[]): boolean {
  const seq = modes.filter(isBreakMode)
  return seq.every((m, i) => m !== seq[(i + 1) % seq.length])
}

/**
 * Slopes (dy/dx at each point) of a C2 cubic spline over segments with widths h
 * and rises dy. Without ends the spline is closed (periodic, one slope per
 * segment start); with ends it is open (one more slope than segments).
 */
function solveSpline(h: number[], dy: number[], ends?: [EndCondition, EndCondition]): number[] {
  const segs = h.length
  const n = ends ? segs + 1 : segs
  const s = dy.map((d, k) => d / h[k])
  const A = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  const b = new Array<number>(n).fill(0)
  for (let k = ends ? 1 : 0; k < (ends ? n - 1 : n); k++) {
    const prev = (k - 1 + segs) % segs
    const cur = k % segs
    A[k][(k - 1 + n) % n] += h[cur]
    A[k][k] += 2 * (h[prev] + h[cur])
    A[k][(k + 1) % n] += h[prev]
    b[k] = 3 * (h[cur] * s[prev] + h[prev] * s[cur])
  }
  if (ends) {
    const setEnd = (row: number, other: number, cond: EndCondition, slope: number) => {
      if (cond === 'natural') {
        A[row][row] = 2
        A[row][other] = 1
        b[row] = 3 * slope
      } else if (cond === 'parabolic') {
        A[row][row] = 1
        A[row][other] = 1
        b[row] = 2 * slope
      } else {
        A[row][row] = 1
        b[row] = cond.clamp
      }
    }
    setEnd(0, 1, ends[0], s[0])
    setEnd(n - 1, n - 2, ends[1], s[segs - 1])
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
  const { approximate, warnings } = compile(graph).analysis
  return { approximate, warnings: [...warnings] }
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

  const seg = compile(graph).segments[i]
  if (seg.width <= 0) return seg.y1
  const f = (u - seg.x0) / seg.width

  switch (seg.mode) {
    case 'linear':
      return seg.y0 + (seg.y1 - seg.y0) * f
    case 'step_end':
      return seg.y0
    case 'step_start':
      return seg.y1
    default:
      if (!seg.m) return seg.y0 + (seg.y1 - seg.y0) * f // zero-width spline segment: a jump
      return hermite(seg.y0, seg.y1, seg.m[0] * seg.width, seg.m[1] * seg.width, f)
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
