import { type KeyboardEvent, type FocusEvent } from 'react'
import { roundTyped, type Graph } from '../core/model'
import { formatCoord } from '../core/table'
import { useStrings } from '../i18n'
import { ModeSelect } from './ModeSelect'
import type { Action } from './state'

interface Props {
  graph: Graph
  selected: number | null
  dispatch: (a: Action) => void
}

/** The active graph as MA's Table Mode shows it, editable in place. */
export function PointTable({ graph, selected, dispatch }: Props) {
  const t = useStrings()

  const shown = (v: number) => String(Number(formatCoord(v)))

  // Commit on Enter or blur; the field then shows what was stored (clamped and
  // rounded), or the old value back if the input was not a number.
  const commit = (index: number, axis: 'x' | 'y') => (e: FocusEvent<HTMLInputElement> | KeyboardEvent<HTMLInputElement>) => {
    if ('key' in e && e.key !== 'Enter') return
    const input = e.currentTarget
    const v = Number(input.value)
    if (input.value.trim() === '' || !Number.isFinite(v)) {
      input.value = shown(graph.points[index][axis])
      return
    }
    input.value = shown(roundTyped(v / 100))
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
          <tr key={i} className={i === selected ? 'selected' : undefined} onClick={() => dispatch({ type: 'select', index: i })}>
            <td className="num">{i + 1}</td>
            {(['x', 'y'] as const).map((axis) => (
              <td key={axis}>
                <input
                  key={p[axis]}
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
              <ModeSelect label={`${t.mode} ${i + 1}`} value={p.mode} onChange={(mode) => dispatch({ type: 'setPoint', index: i, mode })} />
            </td>
            <td>
              <button type="button" className="icon" aria-label={t.deletePoint} title={t.deletePoint} onClick={(e) => {
                  e.stopPropagation()
                  dispatch({ type: 'deletePoint', index: i })
                }}>
                ×
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
