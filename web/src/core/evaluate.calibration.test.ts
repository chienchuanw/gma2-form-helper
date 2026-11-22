/**
 * evaluate() against curves pixel-extracted from the grandMA2 onPC 3.9.60 graph
 * editor (see docs/ma2-form-modes.md). Values are on the 0–100 scale.
 */
import { describe, expect, it } from 'vitest'
import ma from './__fixtures__/ma_curves.json'
import { analyzeGraph, evaluate } from './evaluate'
import type { Graph, Mode } from './model'

const graphOf = (c: (typeof ma.curves)[number]): Graph => ({
  color: 'c0c0c0',
  points: c.points.map((p) => ({ x: p.x / 100, y: p.y / 100, mode: p.mode as Mode })),
})

const errors = (c: (typeof ma.curves)[number]) => {
  const g = graphOf(c)
  return c.samples.map(([x, y]) => Math.abs(evaluate(g, x / 100) * 100 - y))
}

const exactCases = ma.curves.filter((c) => !c.name.startsWith('closed spline'))
const closedCases = ma.curves.filter((c) => c.name.startsWith('closed spline'))

describe('evaluate matches MA', () => {
  it.each(exactCases.map((c) => [c.name, c] as const))('%s within pixel accuracy', (_, c) => {
    // Pixel extraction is good to about ±1 on the 0–100 scale.
    expect(Math.max(...errors(c))).toBeLessThan(1.5)
    expect(analyzeGraph(graphOf(c)).approximate).toBe(false)
  })

  it.each(closedCases.map((c) => [c.name, c] as const))('%s approximately', (_, c) => {
    const e = errors(c)
    const rms = Math.sqrt(e.reduce((s, v) => s + v * v, 0) / e.length)
    expect(rms).toBeLessThan(3)
    expect(Math.max(...e)).toBeLessThan(6.5)
  })
})

describe('analyzeGraph', () => {
  const p = (x: number, y: number, mode: Mode = 'spline') => ({ x, y, mode })

  it('marks a closed all-spline graph as approximate', () => {
    expect(analyzeGraph({ color: 'c0c0c0', points: [p(0, 0.5), p(0.3, 1), p(0.6, 0)] })).toEqual({
      approximate: true,
      warnings: [],
    })
  })

  it('treats linear and step graphs, and bounded spline chains, as exact', () => {
    expect(analyzeGraph({ color: 'c0c0c0', points: [p(0, 0, 'linear'), p(0.5, 1, 'step_end')] }).approximate).toBe(false)
    expect(analyzeGraph({ color: 'c0c0c0', points: [p(0, 0, 'linear'), p(0.3, 1), p(0.6, 0, 'linear')] }).approximate).toBe(false)
  })

  it('warns about a spline touching a vertical jump, which MA does not draw', () => {
    const g = { color: 'c0c0c0', points: [p(0, 0.2), p(0.3, 0.9), p(0.3, 0.1), p(0.7, 0.6)] }

    expect(analyzeGraph(g).warnings).toContain('splineJump')
  })

  it('warns about breaks that do not pair up in an all-spline graph', () => {
    const g = { color: 'c0c0c0', points: [p(0, 0.3), p(0.2, 0.8, 'spline_break_start'), p(0.4, 0.2), p(0.6, 0.9)] }
    const bump = { color: 'c0c0c0', points: [p(0, 0, 'spline_break_start'), p(0.5, 1), p(0.9, 0.3, 'spline_break_end')] }

    expect(analyzeGraph(g).warnings).toContain('unpairedBreak')
    expect(analyzeGraph(bump).warnings).toEqual([])
  })
})
