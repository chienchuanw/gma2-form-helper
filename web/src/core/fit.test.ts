import { describe, expect, it } from 'vitest'
import { analyzeGraph, evaluate } from './evaluate'
import { drawable, fitStroke, precisionToTolerance } from './fit'
import { sortPoints, type Graph, type Point } from './model'

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
    const g = graphOf(stroke(() => 0.5, 0.2, 0.6), 0.02)

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

  it('does not stack points on one grid line when snapping a detailed fit', () => {
    const s = stroke((x) => 0.5 + 0.3 * Math.sin(2 * Math.PI * x) + 0.15 * Math.sin(10 * Math.PI * x))
    const pts = fitStroke(s, { tolerance: precisionToTolerance(10), grid: { x: 0.125, y: 0.1 } })
    const xs = pts.map((p) => p.x)

    expect(new Set(xs).size).toBe(xs.length)
  })

  it('keeps both sides of a drawn jump when snapping', () => {
    const f = (x: number) => (x < 0.5 ? 0.2 + 0.6 * x : 0.9)
    const s = [...stroke(f, 0, 0.5, 100), ...stroke(f, 0.5, 1, 100)]
    const pts = fitStroke(s, { tolerance: 0.02, grid: { x: 0.125, y: 0.1 } })

    expect(evaluate({ color: '', points: pts }, 0.45)).toBeLessThan(0.6)
    expect(evaluate({ color: '', points: pts }, 0.75)).toBeCloseTo(0.9, 1)
  })

  it('never produces a graph MA cannot draw, with or without snapping (fuzz)', () => {
    let seed = 42
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    for (let n = 0; n < 200; n++) {
      const a = rnd(), b = rnd() * 6, c = rnd(), from = rnd() * 0.3, to = 0.7 + rnd() * 0.3
      const f = (x: number) => 0.5 + 0.4 * a * Math.sin(b * Math.PI * x + c) + (rnd() < 0.05 ? 0.3 : 0)
      const s = stroke(f, from, to, 150, 0.01)
      for (const grid of [null, { x: 0.125, y: 0.1 }]) {
        for (const tol of [precisionToTolerance(1), precisionToTolerance(10)]) {
          const pts = fitStroke(s, { tolerance: tol, grid })
          const w = analyzeGraph({ color: '', points: pts }).warnings
          expect(w.filter((x) => x !== 'overshoot')).toEqual([])
          expect(pts.map((p) => p.x)).toEqual([...pts.map((p) => p.x)].sort((p, q) => p - q))
        }
      }
    }
  })

  it('closes a full-cycle sine cleanly at the highest precision with snapping', () => {
    const pts = fitStroke(stroke((x) => 0.5 + 0.45 * Math.sin(2 * Math.PI * x)), { tolerance: precisionToTolerance(10), grid: { x: 0.125, y: 0.1 } })

    expect(analyzeGraph({ color: '', points: pts }).warnings).toEqual([])
  })

  it('cuts a stroke drawn past the edges at exactly 0 and 100', () => {
    const s = stroke((x) => 0.3 + 0.2 * x, -0.1, 1.1, 300)
    const pts = fitStroke(s, { tolerance: 0.02 })

    expect(pts.filter((p) => p.x === 0).length).toBeLessThanOrEqual(1)
    expect(pts.filter((p) => p.x === 1).length).toBeLessThanOrEqual(1)
    expect(pts[0].x).toBe(0)
    expect(pts[0].y).toBeCloseTo(0.3, 1)
  })

  it('ignores samples that are not numbers', () => {
    const s = [...stroke((x) => x, 0, 0.5, 50), { x: NaN, y: 0.5 }, { x: 0.7, y: Infinity }, ...stroke((x) => x, 0.5, 1, 50)]

    expect(fitStroke(s, { tolerance: 0.02 }).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
  })

  it('keeps at most a jump pair on any x, even for slanted edges with snapping', () => {
    // A square edge drawn slightly slanted: climbs over 1.5 units of x.
    const f = (x: number) => (x < 0.37 ? 0.1 : x < 0.385 ? 0.1 + ((x - 0.37) / 0.015) * 0.8 : 0.9)
    for (const grid of [null, { x: 0.125, y: 0.1 }]) {
      const pts = fitStroke(stroke(f, 0, 1, 600, 0.002), { tolerance: 0.02, grid })
      const perX = new Map<number, number>()
      for (const p of pts) perX.set(p.x, (perX.get(p.x) ?? 0) + 1)
      expect(Math.max(...perX.values())).toBeLessThanOrEqual(2)
    }
  })

  it('keeps a quickly drawn, slightly slanted edge vertical when snapping', () => {
    const f = (x: number) => (x < 0.37 ? 0.2 : x < 0.375 ? 0.2 + ((x - 0.37) / 0.005) * 0.7 : 0.9)
    const g = { color: '', points: fitStroke(stroke(f, 0, 1, 600, 0), { tolerance: 0.02, grid: { x: 0.125, y: 0.1 } }) }

    expect(evaluate(g, 0.3)).toBeCloseTo(0.2, 1)
    expect(evaluate(g, 0.4)).toBeCloseTo(0.9, 1)
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

  describe('with a locked mode', () => {
    const sine = (x: number) => 0.5 + 0.4 * Math.sin(2 * Math.PI * x)

    it('uses only Linear segments when locked to Linear', () => {
      const pts = fitStroke(stroke(sine), { tolerance: 0.02, mode: 'linear' })

      expect(pts.every((p) => p.mode === 'linear')).toBe(true)
      expect(maxError({ color: '', points: pts }, sine)).toBeLessThan(0.03)
    })

    it('uses only Spline segments when locked to Spline, apart from drawn jumps', () => {
      const f = (x: number) => (x < 0.5 ? 0.2 + 0.5 * x : 0.9)
      const s = [...stroke(f, 0, 0.5, 100), ...stroke(f, 0.5, 1, 100)]
      const pts = fitStroke(s, { tolerance: 0.02, mode: 'spline' })
      const g = { color: '', points: pts }

      pts.forEach((p, i) => {
        const next = pts[(i + 1) % pts.length]
        const zeroWidth = next.x + (i === pts.length - 1 ? 1 : 0) - p.x <= 0.002
        if (!zeroWidth) expect(p.mode.startsWith('spline')).toBe(true)
      })
      expect(analyzeGraph(g).warnings.filter((w) => w !== 'overshoot')).toEqual([])
      expect(maxError(g, f, 0, 0.49)).toBeLessThan(0.03)
    })

    it('draws a staircase of Step (End) points when locked to Step', () => {
      const ramp = (x: number) => x
      const coarse = fitStroke(stroke(ramp, 0, 1, 300, 0), { tolerance: 0.05, mode: 'step' })
      const fine = fitStroke(stroke(ramp, 0, 1, 300, 0), { tolerance: 0.01, mode: 'step' })

      expect(coarse.every((p) => p.mode === 'step_end')).toBe(true)
      expect(fine.length).toBeGreaterThan(coarse.length)
      // Within the tolerance, plus the 0.1-unit rounding of where each step starts.
      expect(maxError({ color: '', points: coarse }, ramp)).toBeLessThanOrEqual(0.055)
    })

    it('turns a drawn edge into one step change, not a run of tiny steps', () => {
      const f = (x: number) => (x < 0.4 ? 0.2 : x < 0.41 ? 0.2 + (x - 0.4) * 70 : 0.9)
      const pts = fitStroke(stroke(f, 0, 1, 600, 0.002), { tolerance: 0.02, mode: 'step' })

      expect(pts.length).toBeLessThanOrEqual(3)
    })

    it('does not start a step at the very end of the cycle, where it would have no width', () => {
      // The settings of the browser session that showed it: precision 5, snap on.
      const pts = fitStroke(stroke((x) => 0.1 + 0.8 * x, 0, 1, 200, 0), { tolerance: precisionToTolerance(5), mode: 'step', grid: { x: 0.125, y: 0.1 } })

      expect(pts.some((p) => p.x >= 1)).toBe(false)
    })

    it('stays within tolerance after merging a partial stroke into an existing graph (fuzz)', () => {
      let seed = 11
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
      const base: Point[] = [
        { x: 0, y: 0, mode: 'spline' },
        { x: 0.5, y: 1, mode: 'spline' },
      ]
      let bad = 0
      let total = 0
      for (let n = 0; n < 100; n++) {
        const a = rnd(), b = rnd() * 4, c = rnd(), from = 0.05 + rnd() * 0.3, to = from + 0.2 + rnd() * 0.4
        const f = (x: number) => 0.5 + 0.35 * a * Math.sin(b * Math.PI * x + c)
        const s = stroke(f, from, Math.min(0.95, to), 150, 0)
        for (const mode of ['auto', 'linear', 'spline'] as const) {
          const pts = fitStroke(s, { tolerance: 0.02, mode, context: base })
          const lo = Math.min(from, pts[0].x), hi = Math.max(Math.min(0.95, to), pts[pts.length - 1].x)
          const merged = drawable(sortPoints([...base.filter((p) => p.x < lo - 1e-9 || p.x > hi + 1e-9), ...pts]))
          const g = { color: '', points: merged }
          total++
          if (maxError(g, f, from, Math.min(0.95, to)) > 0.03) bad++
        }
      }
      // Within the drawn span. Outside it, existing Spline points of the graph may still
      // bend into the new points; MA draws that the same way and analyzeGraph flags overshoots.
      expect(bad / total).toBeLessThan(0.05)
    })

    it('does not let a Spline-locked stroke inherit a near-vertical bridge into kept points', () => {
      // Reviewer's repro: a flat stroke at 90 whose snapped end lands right next to a kept point.
      const context: Point[] = [
        { x: 0, y: 0, mode: 'linear' },
        { x: 0.5, y: 1, mode: 'linear' },
        { x: 0.885, y: 0, mode: 'linear' },
      ]
      const pts = fitStroke(stroke(() => 0.9, 0.55, 0.82, 150, 0), { tolerance: precisionToTolerance(5), grid: { x: 0.125, y: 0.1 }, mode: 'spline', context })
      const lo = Math.min(0.55, pts[0].x), hi = Math.max(0.82, pts[pts.length - 1].x)
      const g = { color: '', points: drawable(sortPoints([...context.filter((p) => p.x < lo - 1e-9 || p.x > hi + 1e-9), ...pts])) }

      expect(maxError(g, () => 0.9, 0.55, 0.82)).toBeLessThan(0.1)
    })

    it('keeps locked fits drawable in MA, with and without snapping (fuzz)', () => {
      let seed = 3
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
      for (let n = 0; n < 60; n++) {
        const a = rnd(), b = rnd() * 6, c = rnd()
        const s = stroke((x) => 0.5 + 0.4 * a * Math.sin(b * Math.PI * x + c), rnd() * 0.3, 0.7 + rnd() * 0.3, 150, 0.01)
        for (const mode of ['linear', 'spline', 'step'] as const) {
          for (const grid of [null, { x: 0.125, y: 0.1 }]) {
            const pts = fitStroke(s, { tolerance: 0.02, grid, mode })
            expect(analyzeGraph({ color: '', points: pts }).warnings.filter((w) => w !== 'overshoot')).toEqual([])
            expect(pts.map((p) => p.x)).toEqual([...pts.map((p) => p.x)].sort((p, q) => p - q))
          }
        }
      }
    })
  })
})
