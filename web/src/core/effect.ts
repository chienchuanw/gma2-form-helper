import { evaluate } from './evaluate'
import type { Graph } from './model'

/**
 * How a Form plays as a dimmer effect on a row of fixtures.
 *
 * The spread, the phase sign and the Speed conversion below are NOT yet
 * measured on grandMA2 (issue #25); MA's documentation does not settle them.
 * Keep every such rule in this file so the calibration only changes it.
 */

export interface EffectParams {
  count: number
  /** Degrees given to the first fixture, as in MA's Phase "start Thru end". */
  phaseStart: number
  phaseEnd: number
  /** Output range, 0–100. Low above High inverts the Form. */
  low: number
  high: number
}

export interface PreviewSettings extends EffectParams {
  /** Music tempo; one cycle of the Form is one bar. */
  bpm: number
}

/** 8 fixtures half a beat apart (MA's default Phase 0 Thru −360) at 120 BPM over the full range. */
export const DEFAULT_PREVIEW: PreviewSettings = { count: 8, bpm: 120, phaseStart: 0, phaseEnd: -360, low: 0, high: 100 }

/** Allowed [min, max] of each setting. Phase follows MA's range. */
export const LIMITS = {
  count: [1, 32],
  bpm: [20, 300],
  phase: [-2880, 2880],
  level: [0, 100],
} as const

/** MA's phase presets [start, end]: forwards, backwards, all in sync. */
export const PHASE_PRESETS: readonly (readonly [number, number])[] = [
  [0, -360],
  [0, 360],
  [0, 0],
]

interface FixtureState {
  /** Phase in degrees. */
  phase: number
  /** Where this fixture is on the Form, 0–1. */
  x: number
  /** The graph's value there (0–1, a Spline may overshoot). */
  value: number
  /** Output level, 0–100. */
  level: number
}

/**
 * Phase of fixture i of n. Unverified: the spread steps by (end − start) / n, so
 * 8 fixtures at 0 Thru −360 end at −315 and the wave repeats evenly.
 */
export function phaseFor(i: number, n: number, start: number, end: number): number {
  return start + ((end - start) * i) / n
}

/** Seconds per cycle: one cycle of the Form is one bar of four beats at this tempo. */
export function cycleSeconds(bpm: number): number {
  return 240 / bpm
}

/** MA's Effect Speed for one cycle per bar. Unverified: assumes MA's BPM counts cycles per minute. */
export function maEffectSpeed(bpm: number): number {
  return bpm / 4
}

const wrap = (v: number) => v - Math.floor(v)

/** Where a fixture with this phase is on the Form. Unverified: a negative phase lags, so 0 Thru −360 runs from the first fixture to the last. */
function positionOf(pos: number, phase: number): number {
  return wrap(pos + phase / 360)
}

/** Output level 0–100: Low + (High − Low) · value, clamped (a Spline may overshoot). */
function level(value: number, low: number, high: number): number {
  return Math.min(100, Math.max(0, low + (high - low) * value))
}

/** Every fixture's state at bar position pos (cycles, any real number). */
export function fixtureFrame(graph: Graph, pos: number, p: EffectParams): FixtureState[] {
  return Array.from({ length: p.count }, (_, i) => {
    const phase = phaseFor(i, p.count, p.phaseStart, p.phaseEnd)
    const x = positionOf(pos, phase)
    const value = evaluate(graph, x)
    return { phase, x, value, level: level(value, p.low, p.high) }
  })
}
