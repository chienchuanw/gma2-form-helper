import { type KeyboardEvent, type FocusEvent } from 'react'
import { MODES, type Graph, type Mode } from '../core/model'
import { MODE_LABELS, formatCoord } from '../core/table'
import { useStrings } from '../i18n'
import type { Action } from './state'

interface Props {
  graph: Graph
  selected: number | null
  dispatch: (a: Action) => void
}

/** The active graph as MA's Table Mode shows it, editable in place. */
export function PointTable({ graph, selected, dispatch }: Props) {
  const t = useStrings()

  const commit = (index: number, axis: 'x' | 'y') => (e: FocusEvent<HTMLInputElement> | KeyboardEvent<HTMLInputElement>) => {
    if ('key' in e && e.key !== 'Enter') return
    const v = Number(e.currentTarget.value)
    if (e.currentTarget.value.trim() === '' || !Number.isFinite(v)) return
    if (Math.abs(v / 100 - graph.points[index][axis]) < 1e-9) return
    dispatch({ type: 'setPoint', index, [axis]: v / 100 })
  }

  return (
    <table className="points" aria-label={t.points}>
      <thead>
        <tr>
          <th scope="col">{t.no}</th>
          <th scope="col">X</th>
          <th scope="col">Y</th>
          <th scope="col">{t.mode}</th>
          <th scope="col">
            <span className="visually-hidden">{t.deletePoint}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {graph.points.map((p, i) => (
          <tr key={`${i}:${p.x}:${p.y}`} className={i === selected ? 'selected' : undefined} onClick={() => dispatch({ type: 'select', index: i })}>
            <td className="num">{i + 1}</td>
            {(['x', 'y'] as const).map((axis) => (
              <td key={axis}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  aria-label={`${axis.toUpperCase()} ${i + 1}`}
                  defaultValue={Number(formatCoord(p[axis]))}
                  onBlur={commit(i, axis)}
                  onKeyDown={commit(i, axis)}
                />
              </td>
            ))}
            <td>
              <select
                aria-label={`${t.mode} ${i + 1}`}
                value={p.mode}
                onChange={(e) => dispatch({ type: 'setPoint', index: i, mode: e.target.value as Mode })}
              >
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m]}
                  </option>
                ))}
              </select>
            </td>
            <td>
              <button type="button" className="icon" aria-label={t.deletePoint} title={t.deletePoint} onClick={() => dispatch({ type: 'deletePoint', index: i })}>
                ×
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
