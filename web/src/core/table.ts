import type { Form, Graph, Mode } from './model'

/** Names exactly as the Mode column of MA's Table Mode shows them. */
export const MODE_LABELS: Record<Mode, string> = {
  linear: 'Linear',
  spline: 'Spline',
  spline_break_start: 'Spline (Break at Start)',
  spline_break_end: 'Spline (Break at End)',
  step_start: 'Step (Start)',
  step_end: 'Step (End)',
}

export interface TableRow {
  no: number
  x: string
  y: string
  mode: string
}

/** A 0–1 value as MA shows it: 0–100 with two decimals. */
export function formatCoord(v: number): string {
  const s = (v * 100).toFixed(2)
  return s === '-0.00' ? '0.00' : s
}

export function tableRows(graph: Graph): TableRow[] {
  return graph.points.map((p, i) => ({
    no: i + 1,
    x: formatCoord(p.x),
    y: formatCoord(p.y),
    mode: MODE_LABELS[p.mode],
  }))
}

/** Round a 0–1 value to one decimal on the 0–100 scale (0.001), clamped to 0–1. */
export function roundCoord(v: number): number {
  return Math.min(1, Math.max(0, Math.round(v * 1000) / 1000))
}

/** Tab-separated tables, one block per graph, for pasting into notes or a sheet. */
export function tableText(form: Form): string {
  return form.graphs
    .map((g, i) => {
      const title = g.name ? `[${i + 1}] ${g.name}` : `[${i + 1}]`
      const rows = tableRows(g).map((r) => [r.no, r.x, r.y, r.mode].join('\t'))
      return [title, 'No.\tX\tY\tMode', ...rows].join('\n')
    })
    .join('\n\n')
}
