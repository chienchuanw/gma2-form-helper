import type { Graph, Mode } from './model'

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
  let i = pts.findLastIndex((q) => q.x <= u)
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
      const ma = mode === 'spline_break_start' ? secant : slope(xAt(i - 1), yAt(i - 1), bx, by, secant)
      const mb = mode === 'spline_break_end' ? secant : slope(ax, ay, xAt(i + 2), yAt(i + 2), secant)
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

/** n + 1 evenly spaced samples from x = 0 to x = 1. */
export function sampleGraph(graph: Graph, n: number): { x: number; y: number }[] {
  return Array.from({ length: n + 1 }, (_, k) => {
    const x = k / n
    return { x, y: evaluate(graph, x) }
  })
}
