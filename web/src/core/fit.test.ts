import { describe, expect, it } from 'vitest'
import { analyzeGraph, evaluate } from './evaluate'
import { fitStroke, precisionToTolerance } from './fit'
import type { Graph } from './model'

type S = { x: number; y: number }

/** A stroke sampled the way a pointer would report it: dense, slightly noisy. */
function stroke(f: (x: number) => number, from = 0, to = 1, n = 300, noise = 0.002): S[] {
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2
  return Array.from({ length: n + 1 }, (_, i) => {
    const x = from + ((to - from) * i) / n
    return { x, y: f(x) + rand() * noise }
  })
}

const graphOf = (s: S[], tol: number): Graph => ({ color: 'c0c0c0', points: fitStroke(s, { tolerance: tol }) })

/** Largest distance between the fitted curve and the clean target over the stroke's span. */
function maxError(g: Graph, f: (x: number) => number, from = 0, to = 1) {
  let worst = 0
  for (let x = from + 0.01; x < to - 0.01; x += 0.005) worst = Math.max(worst, Math.abs(evaluate(g, x) - f(x)))
  return worst
}

describe('fitStroke', () => {
  it('turns a ramp into a couple of linear points', () => {
    const f = (x: number) => x
    const g = graphOf(stroke(f), 0.02)

    expect(g.points.length).toBeLessThanOrEqual(3)
    expect(g.points.every((p) => p.mode === 'linear')).toBe(true)
    expect(maxError(g, f)).toBeLessThan(0.03)
  })

  it('fits a sine with a few spline points', () => {
    const f = (x: number) => 0.5 + 0.45 * Math.sin(2 * Math.PI * x)
    const g = graphOf(stroke(f), 0.02)

    expect(g.points.length).toBeLessThanOrEqual(10)
    expect(g.points.filter((p) => p.mode.startsWith('spline')).length).toBeGreaterThan(g.points.length / 2)
    expect(maxError(g, f)).toBeLessThan(0.04)
  })

  it('turns a square wave into a handful of points with vertical jumps', () => {
    const f = (x: number) => (x < 0.5 ? 0.9 : 0.1)
    const s = [...stroke(f, 0, 0.5, 100), { x: 0.5, y: 0.5 }, ...stroke(f, 0.5, 1, 100)]
    const g = graphOf(s, 0.02)

    expect(g.points.length).toBeLessThanOrEqual(4)
    expect(evaluate(g, 0.25)).toBeCloseTo(0.9, 1)
    expect(evaluate(g, 0.75)).toBeCloseTo(0.1, 1)
  })

  it('never leaves a spline segment of zero width, which MA refuses to draw', () => {
    const f = (x: number) => (x < 0.5 ? 0.3 + 0.4 * Math.sin(6 * x) : 0.2)
    const s = [...stroke(f, 0, 0.5, 120), ...stroke(f, 0.5, 1, 120)]
    const g = graphOf(s, 0.01)

    expect(analyzeGraph(g).warnings).not.toContain('splineJump')
    expect(analyzeGraph(g).warnings).not.toContain('unpairedBreak')
  })

  it('keeps a sharp corner between two curves without warnings', () => {
    const f = (x: number) => 1 - Math.abs(Math.sin(Math.PI * 2 * x)) // two arches meeting in a cusp
    const g = graphOf(stroke(f), 0.02)

    expect(maxError(g, f)).toBeLessThan(0.05)
    expect(analyzeGraph(g).warnings).toEqual([])
  })

  it('ignores backtracking so the result stays a function of x', () => {
    const s: S[] = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 0.4, y: 0.9 }, // pointer went back
      { x: 1, y: 1 },
    ]
    const xs = fitStroke(s, { tolerance: 0.02 }).map((p) => p.x)

    expect(xs).toEqual([...xs].sort((a, b) => a - b))
  })

  it('fits only the span that was drawn', () => {
    const g = graphOf(stroke((x) => 0.5, 0.2, 0.6), 0.02)

    expect(Math.min(...g.points.map((p) => p.x))).toBeCloseTo(0.2, 2)
    expect(Math.max(...g.points.map((p) => p.x))).toBeCloseTo(0.6, 2)
  })

  it('rounds points to one decimal on the 0–100 scale and can snap to a grid', () => {
    const pts = fitStroke(stroke((x) => x * 0.8 + 0.1), { tolerance: 0.02, grid: { x: 0.125, y: 0.1 } })

    for (const p of pts) {
      expect(Math.round(p.x * 1000)).toBe(p.x * 1000)
      expect(Math.round(p.x / 0.125) * 0.125).toBeCloseTo(p.x, 9)
      expect(Math.round(p.y / 0.1) * 0.1).toBeCloseTo(p.y, 9)
    }
  })

  it('returns nothing for a stroke too short to fit', () => {
    expect(fitStroke([{ x: 0.5, y: 0.5 }], { tolerance: 0.02 })).toEqual([])
  })

  it('uses fewer points as the tolerance grows', () => {
    const s = stroke((x) => 0.5 + 0.3 * Math.sin(2 * Math.PI * x) + 0.15 * Math.sin(10 * Math.PI * x))
    const counts = [1, 3, 5, 7, 10].map((p) => fitStroke(s, { tolerance: precisionToTolerance(p) }).length)

    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1])
    expect(counts[4]).toBeGreaterThan(counts[0])
  })
})
