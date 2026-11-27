import { describe, expect, it } from 'vitest'
import { cycleSeconds, fixtureFrame, levelAt, maEffectSpeed, phaseFor } from './effect'
import { sampleGraph } from './evaluate'
import type { Graph } from './model'

/** 0 at x = 0, 100 at x = 50, back to 0 at x = 100 (the editor's default graph). */
const triangle: Graph = {
  color: 'c0c0c0',
  points: [
    { x: 0, y: 0, mode: 'linear' },
    { x: 0.5, y: 1, mode: 'linear' },
  ],
}

describe('phaseFor', () => {
  it('spreads start to end evenly so the last fixture stops one step short of the end', () => {
    expect(Array.from({ length: 8 }, (_, i) => phaseFor(i, 8, 0, -360))).toEqual([0, -45, -90, -135, -180, -225, -270, -315])
  })

  it('gives a single fixture the start phase', () => {
    expect(phaseFor(0, 1, 90, -360)).toBe(90)
  })

  it('allows more than one wave across the row', () => {
    expect(Array.from({ length: 4 }, (_, i) => phaseFor(i, 4, 0, 720))).toEqual([0, 180, 360, 540])
  })
})

describe('speed', () => {
  it('plays one bar of four beats per cycle', () => {
    expect(cycleSeconds(120)).toBe(2)
    expect(cycleSeconds(60)).toBe(4)
  })

  it('converts the music tempo to the Effect Speed MA needs for one cycle per bar', () => {
    expect(maEffectSpeed(128)).toBe(32)
    expect(maEffectSpeed(90)).toBe(22.5)
  })
})

describe('levelAt', () => {
  it('reads the graph at the bar position on a 0–100 scale', () => {
    expect(levelAt(triangle, 0.25, 0, 0, 100)).toBeCloseTo(50)
    expect(levelAt(triangle, 0.5, 0, 0, 100)).toBeCloseTo(100)
  })

  it('makes a negative phase lag behind', () => {
    // -90° is a quarter bar behind: at 0.5 it shows what phase 0 showed at 0.25.
    expect(levelAt(triangle, 0.5, -90, 0, 100)).toBeCloseTo(50)
    expect(levelAt(triangle, 0.25, -90, 0, 100)).toBeCloseTo(0)
  })

  it('wraps around the bar', () => {
    expect(levelAt(triangle, 0.1, -90, 0, 100)).toBeCloseTo(30) // reads x = 0.85
    expect(levelAt(triangle, 1.25, 360, 0, 100)).toBeCloseTo(50)
    expect(levelAt(triangle, 0.25, -720, 0, 100)).toBeCloseTo(50)
  })

  it('maps the graph between Low and High', () => {
    expect(levelAt(triangle, 0.25, 0, 20, 80)).toBeCloseTo(50)
    expect(levelAt(triangle, 0.5, 0, 20, 80)).toBeCloseTo(80)
    expect(levelAt(triangle, 0, 0, 20, 80)).toBeCloseTo(20)
  })

  it('inverts when Low is above High', () => {
    expect(levelAt(triangle, 0.125, 0, 100, 0)).toBeCloseTo(75)
  })

  it('never leaves 0–100 when a Spline overshoots', () => {
    // A Spline chain next to a near-vertical segment (see evaluate.calibration.test.ts).
    const overshooting: Graph = {
      color: 'c0c0c0',
      points: [
        { x: 0, y: 0.2, mode: 'spline' },
        { x: 0.3, y: 0.8, mode: 'spline' },
        { x: 0.5, y: 0.3, mode: 'linear' },
        { x: 0.503, y: 0.9, mode: 'spline' },
        { x: 0.8, y: 0.5, mode: 'spline' },
      ],
    }
    const samples = sampleGraph(overshooting, 200).map((s) => s.y)
    expect(Math.max(...samples) > 1 || Math.min(...samples) < 0).toBe(true) // precondition

    for (let k = 0; k <= 200; k++) {
      const level = levelAt(overshooting, k / 200, 0, 0, 100)
      expect(level).toBeGreaterThanOrEqual(0)
      expect(level).toBeLessThanOrEqual(100)
    }
  })
})

describe('fixtureFrame', () => {
  it('gives each fixture its phase, position on the Form and level', () => {
    const frame = fixtureFrame(triangle, 0.5, { count: 4, phaseStart: 0, phaseEnd: -360, low: 0, high: 100 })

    expect(frame.map((f) => f.phase)).toEqual([0, -90, -180, -270])
    expect(frame.map((f) => f.x)).toEqual([0.5, 0.25, 0, 0.75])
    expect(frame[1].value).toBeCloseTo(0.5)
    expect(frame.map((f) => f.level)).toEqual([expect.closeTo(100), expect.closeTo(50), expect.closeTo(0), expect.closeTo(50)])
  })
})
