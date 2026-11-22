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
  return (Math.round(v * 10000) / 100 + 0).toFixed(2) // + 0 turns -0 into 0
}

export function tableRows(graph: Graph): TableRow[] {
  return graph.points.map((p, i) => ({
    no: i + 1,
    x: formatCoord(p.x),
    y: formatCoord(p.y),
    mode: MODE_LABELS[p.mode],
  }))
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
