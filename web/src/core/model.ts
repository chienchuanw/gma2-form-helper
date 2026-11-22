/** Point modes as written in grandMA2 Form XML. */
export const MODES = [
  'linear',
  'spline',
  'spline_break_start',
  'spline_break_end',
  'step_start',
  'step_end',
] as const

export type Mode = (typeof MODES)[number]

/** A graph point. x and y are 0–1, exactly as stored in MA's XML. */
export interface Point {
  readonly x: number
  readonly y: number
  readonly mode: Mode
}

/**
 * One graph of a Form (a <SubForm> in MA's XML). Points are sorted by x.
 * Graphs are immutable: change one by building a new Graph (evaluate caches per object).
 */
export interface Graph {
  readonly name?: string
  /** Six-digit hex RGB without '#', e.g. "c0c0c0". */
  readonly color: string
  readonly points: readonly Point[]
}

export interface Form {
  name: string
  display2d: boolean
  graphs: Graph[]
}

/** Points sorted by x. Points sharing an x keep their order (MA's creation order), which is how vertical jumps are drawn. */
export function sortPoints(points: readonly Point[]): Point[] {
  return [...points].sort((a, b) => a.x - b.x)
}

/** Round a 0–1 value to one decimal on the 0–100 scale (0.001), clamped to 0–1. Applied to points the tool creates or moves. */
export function roundCoord(v: number): number {
  return Math.min(1, Math.max(0, Math.round(v * 1000) / 1000))
}

/** Round a typed 0–1 value to MA's two decimals on the 0–100 scale (0.0001), clamped to 0–1. */
export function roundTyped(v: number): number {
  return Math.min(1, Math.max(0, Math.round(v * 10000) / 10000))
}
