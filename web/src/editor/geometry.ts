import { evaluate } from '../core/evaluate'
import type { Graph } from '../core/model'

/** SVG layout of the plot: viewBox units, with room for axis labels. */
export const PLOT = { left: 48, top: 16, width: 1000, height: 500, right: 16, bottom: 32 }
export const VIEW_W = PLOT.left + PLOT.width + PLOT.right
export const VIEW_H = PLOT.top + PLOT.height + PLOT.bottom

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

export function toSvg(x: number, y: number): [number, number] {
  return [PLOT.left + x * PLOT.width, PLOT.top + (1 - y) * PLOT.height]
}

export function fromSvg(sx: number, sy: number): [number, number] {
  return [clamp01((sx - PLOT.left) / PLOT.width), clamp01(1 - (sy - PLOT.top) / PLOT.height)]
}

/** Snap a 0–1 value to a grid step (0 = off). */
export function snap(v: number, step: number): number {
  return step > 0 ? Math.round(v / step) * step : v
}

/**
 * Points along one cycle (0–1) for drawing: evenly spaced samples plus both sides
 * of every point, so jumps come out as vertical lines.
 */
export function curvePoints(graph: Graph, samples = 400): [number, number][] {
  const xs = new Set<number>()
  for (let i = 0; i <= samples; i++) xs.add(i / samples)
  for (const p of graph.points) xs.add(p.x)
  const out: [number, number][] = []
  for (const x of [...xs].sort((a, b) => a - b)) {
    if (x > 0) out.push([x, evaluate(graph, x, 'left')])
    if (x < 1) {
      const right = evaluate(graph, x)
      if (out.length === 0 || out[out.length - 1][1] !== right || out[out.length - 1][0] !== x) out.push([x, right])
    }
  }
  return out
}

const pathCache = new WeakMap<Graph, string>()

/** SVG path data for a graph's curve (cached per immutable graph object). */
export function curvePath(graph: Graph): string {
  let d = pathCache.get(graph)
  if (d === undefined) {
    d = curvePoints(graph)
      .map(([x, y], i) => {
        const [sx, sy] = toSvg(x, y)
        return `${i === 0 ? 'M' : 'L'}${sx.toFixed(1)},${sy.toFixed(1)}`
      })
      .join('')
    pathCache.set(graph, d)
  }
  return d
}

/** Index of the point closest to (sx, sy) within `radius` SVG units, or null. */
export function nearestPoint(graph: Graph, sx: number, sy: number, radius: number): number | null {
  let best: number | null = null
  let bestD = radius
  graph.points.forEach((p, i) => {
    const [px, py] = toSvg(p.x, p.y)
    const d = Math.hypot(px - sx, py - sy)
    if (d <= bestD) {
      best = i
      bestD = d
    }
  })
  return best
}
