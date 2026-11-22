import type { Graph, Mode, Point } from './model'

/** Modes whose curve is known exactly; the rest are drawn with an approximation. */
export function isExactMode(mode: Mode): boolean {
  return mode === 'linear' || mode === 'step_start' || mode === 'step_end'
}

/**
 * Value of a graph at time t (0–1, periodic). Each point's mode governs the
 * segment from that point to the next; the last point connects back to the first
 * across x = 1.
 */
export function evaluate(graph: Graph, t: number): number {
  const pts = graph.points
  const n = pts.length
  if (n === 0) return 0
  if (n === 1) return pts[0].y

  let u = t - Math.floor(t)
  let i = -1
  for (let k = 0; k < n; k++) if (pts[k].x <= u) i = k
  if (i === -1) {
    i = n - 1
    u += 1
  }

  const at = (k: number): Point => {
    const wraps = Math.floor(k / n)
    const q = pts[k - wraps * n]
    return { ...q, x: q.x + wraps }
  }
  const a = at(i)
  const b = at(i + 1)
  const width = b.x - a.x
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
      const secant = (b.y - a.y) / width
      const ma = a.mode === 'spline_break_start' ? secant : slope(at(i - 1), b, secant)
      const mb = a.mode === 'spline_break_end' ? secant : slope(a, at(i + 2), secant)
      return hermite(a.y, b.y, ma * width, mb * width, f)
    }
  }
}

/** Central-difference tangent through the neighbours; falls back to the secant. */
function slope(prev: Point, next: Point, fallback: number): number {
  const dx = next.x - prev.x
  return dx > 1e-9 ? (next.y - prev.y) / dx : fallback
}

function hermite(y0: number, y1: number, m0: number, m1: number, f: number): number {
  const f2 = f * f
  const f3 = f2 * f
  return (
    (2 * f3 - 3 * f2 + 1) * y0 + (f3 - 2 * f2 + f) * m0 + (-2 * f3 + 3 * f2) * y1 + (f3 - f2) * m1
  )
}

/** n + 1 evenly spaced samples from x = 0 to x = 1. */
export function sampleGraph(graph: Graph, n: number): { x: number; y: number }[] {
  return Array.from({ length: n + 1 }, (_, k) => {
    const x = k / n
    return { x, y: evaluate(graph, x) }
  })
}
