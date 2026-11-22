import type { Graph, Mode } from './model'

/**
 * Modes whose curve is known exactly; the rest are drawn with an approximation.
 * Only linear until the step and spline modes are calibrated against MA (issue #2).
 */
export function isExactMode(mode: Mode): boolean {
  return mode === 'linear'
}

/** Neighbouring points at most this far apart in x (0.2 on the 0–100 scale) are a vertical jump, not a curve to follow. */
const JUMP_WIDTH = 0.002

/**
 * Value of a graph at time t (0–1, periodic). Each point's mode governs the
 * segment from that point to the next; the last point connects back to the first
 * across x = 1.
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

  // Index k may run past either end; the point repeats with x shifted by whole periods.
  const xAt = (k: number) => pts[((k % n) + n) % n].x + Math.floor(k / n)
  const yAt = (k: number) => pts[((k % n) + n) % n].y
  const ax = xAt(i)
  const bx = xAt(i + 1)
  const ay = pts[i].y
  const by = yAt(i + 1)
  const width = bx - ax
  if (width <= 0) return by
  const f = (u - ax) / width
  const mode = pts[i].mode

  switch (mode) {
    case 'linear':
      return ay + (by - ay) * f
    case 'step_end':
      return ay
    case 'step_start':
      return by
    default: {
      const secant = (by - ay) / width
      // A break, or a jump right next to the point, cuts the curve there: use the secant.
      const breakA = mode === 'spline_break_start' || ax - xAt(i - 1) <= JUMP_WIDTH + 1e-9
      const breakB = mode === 'spline_break_end' || xAt(i + 2) - bx <= JUMP_WIDTH + 1e-9
      const ma = breakA ? secant : slope(xAt(i - 1), yAt(i - 1), bx, by, secant)
      const mb = breakB ? secant : slope(ax, ay, xAt(i + 2), yAt(i + 2), secant)
      return hermite(ay, by, ma * width, mb * width, f)
    }
  }
}

/** Central-difference tangent through the neighbours; falls back to the secant. */
function slope(x0: number, y0: number, x1: number, y1: number, fallback: number): number {
  const dx = x1 - x0
  return dx > 1e-9 ? (y1 - y0) / dx : fallback
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
