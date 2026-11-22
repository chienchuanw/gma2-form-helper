import { describe, expect, it } from 'vitest'
import builtinXml from './__fixtures__/fh_builtin_forms.xml?raw'
import type { Graph, Mode, Point } from './model'
import { evaluate, isExactMode, sampleGraph } from './evaluate'
import { parseFormsXml } from './xml'

const p = (x: number, y: number, mode: Mode = 'linear'): Point => ({ x, y, mode })
const g = (...points: Point[]): Graph => ({ color: 'c0c0c0', points })

describe('evaluate', () => {
  it('returns 0 for an empty graph and the constant for a single point', () => {
    expect(evaluate(g(), 0.3)).toBe(0)
    expect(evaluate(g(p(0.4, 0.7)), 0.1)).toBe(0.7)
    expect(evaluate(g(p(0.4, 0.7)), 0.9)).toBe(0.7)
  })

  it('interpolates linear segments exactly', () => {
    const ramp = g(p(0, 0), p(0.5, 1))

    expect(evaluate(ramp, 0)).toBe(0)
    expect(evaluate(ramp, 0.25)).toBeCloseTo(0.5, 12)
    expect(evaluate(ramp, 0.5)).toBe(1)
  })

  it('wraps from the last point back to the first across x = 1', () => {
    // Built-in "Ramp": (0,0) -> (0.5,1), then 1 -> 0 over the wrap.
    const ramp = g(p(0, 0), p(0.5, 1))

    expect(evaluate(ramp, 0.75)).toBeCloseTo(0.5, 12)
    // "Phase 1" style: first point is not at x = 0.
    const late = g(p(0.25, 0), p(0.75, 1))
    expect(evaluate(late, 0)).toBeCloseTo(0.5, 12) // wrap segment (0.75,1) -> (1.25,0)
    expect(evaluate(late, 0.9)).toBeCloseTo(0.7, 12)
  })

  it('treats t outside [0,1) as periodic', () => {
    const ramp = g(p(0, 0), p(0.5, 1))

    expect(evaluate(ramp, 1.25)).toBeCloseTo(evaluate(ramp, 0.25), 12)
    expect(evaluate(ramp, -0.75)).toBeCloseTo(evaluate(ramp, 0.25), 12)
  })

  it('jumps vertically between two points sharing an x', () => {
    const jump = g(p(0, 0), p(0.5, 1), p(0.5, 0.2), p(0.9, 0.2))

    expect(evaluate(jump, 0.49)).toBeCloseTo(0.98, 12)
    expect(evaluate(jump, 0.5)).toBeCloseTo(0.2, 12)
    expect(evaluate(jump, 0.7)).toBeCloseTo(0.2, 12)
    expect(evaluate(jump, 0.5, 'left')).toBeCloseTo(1, 12)
  })

  it('holds the start value through a step_end segment', () => {
    const s = g(p(0, 0.2, 'step_end'), p(0.5, 0.8))

    expect(evaluate(s, 0.1)).toBe(0.2)
    expect(evaluate(s, 0.49)).toBe(0.2)
    expect(evaluate(s, 0.5)).toBe(0.8)
  })

  it('jumps to the end value at the start of a step_start segment', () => {
    const s = g(p(0, 0.2, 'step_start'), p(0.5, 0.8))

    expect(evaluate(s, 0.01)).toBe(0.8)
    expect(evaluate(s, 0.49)).toBe(0.8)
  })

  it('passes spline segments through their points', () => {
    const s = g(p(0, 0.5, 'spline'), p(0.25, 1, 'spline'), p(0.5, 0.5, 'spline'), p(0.75, 0, 'spline'))

    for (const pt of s.points) expect(evaluate(s, pt.x)).toBeCloseTo(pt.y, 12)
  })

  it('approximates a sine with the built-in Sin form', () => {
    const sin = parseFormsXml(builtinXml).find((f) => f.name === 'Sin')!.graphs[0]

    for (let t = 0; t < 1; t += 0.01) {
      expect(evaluate(sin, t)).toBeCloseTo(0.5 + 0.5 * Math.sin(2 * Math.PI * t), 1)
    }
  })

  it('keeps spline curves continuous', () => {
    const s = g(p(0, 0.1, 'spline'), p(0.3, 0.9, 'spline_break_start'), p(0.6, 0.4, 'spline_break_end'), p(0.8, 0.6, 'spline'))

    for (let t = 0; t < 1; t += 0.001) {
      expect(Math.abs(evaluate(s, t + 0.0005) - evaluate(s, t))).toBeLessThan(0.01)
    }
  })

  it('makes break modes meet the neighbouring point as a straight-line corner', () => {
    // A break at the end means the segment arrives with its own secant slope.
    const s = g(p(0, 0, 'spline_break_end'), p(0.5, 1, 'spline'), p(0.75, 0, 'spline'))
    const h = 1e-6
    const arriving = (evaluate(s, 0.5) - evaluate(s, 0.5 - h)) / h

    expect(arriving).toBeCloseTo(2, 3) // secant slope of (0,0)->(0.5,1)
  })
})

describe('evaluate next to vertical jumps', () => {
  it('does not overshoot a spline whose neighbour shares its x', () => {
    const s = g(p(0, 0, 'spline'), p(0.5, 1, 'spline'), p(0.5, 0, 'spline'), p(0.75, 0.5, 'spline'))

    for (let t = 0; t < 1; t += 0.005) {
      const v = evaluate(s, t)
      // Without jump handling this reached about 1.22 / -0.22.
      expect(v).toBeGreaterThanOrEqual(-0.01)
      expect(v).toBeLessThanOrEqual(1.01)
    }
  })
})

describe('sampleGraph', () => {
  it('ends with the value reached at the end of the cycle, not the next cycle', () => {
    const rampPlus = g(p(0, 0), p(1, 1))
    const holdEnd = g(p(0, 0.2), p(0.5, 0.8, 'step_end'))

    expect(sampleGraph(rampPlus, 4).at(-1)?.y).toBeCloseTo(1, 12)
    expect(sampleGraph(holdEnd, 4).at(-1)?.y).toBe(0.8)
    expect(sampleGraph(holdEnd, 4)[0].y).toBe(0.2)
  })

  it('needs at least one interval', () => {
    expect(() => sampleGraph(g(p(0, 0)), 0)).toThrow(RangeError)
  })

  it('samples n+1 evenly spaced points from 0 to 1', () => {
    const s = sampleGraph(g(p(0, 0), p(1, 1)), 4)

    expect(s.map((q) => q.x)).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(s[2].y).toBeCloseTo(0.5, 12)
  })
})

describe('isExactMode', () => {
  it('treats only linear as exact until the other modes are calibrated against MA', () => {
    expect(isExactMode('linear')).toBe(true)
    for (const m of ['spline', 'spline_break_start', 'spline_break_end', 'step_start', 'step_end'] as const) {
      expect(isExactMode(m)).toBe(false)
    }
  })
})
