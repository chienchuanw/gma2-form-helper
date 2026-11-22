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
  x: number
  y: number
  mode: Mode
}

/** One graph of a Form (a <SubForm> in MA's XML). Points are sorted by x. */
export interface Graph {
  name?: string
  /** Six-digit hex RGB without '#', e.g. "c0c0c0". */
  color: string
  points: Point[]
}

export interface Form {
  name: string
  display2d: boolean
  graphs: Graph[]
}
