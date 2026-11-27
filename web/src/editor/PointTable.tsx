import { roundTyped, type Graph } from '../core/model'
import { formatCoord } from '../core/table'
import { useStrings } from '../i18n'
import { ModeSelect } from './ModeSelect'
import { NumberField } from './NumberField'
import type { Action } from './state'

interface Props {
  graph: Graph
  selected: number | null
  dispatch: (a: Action) => void
}

/** The active graph as MA's Table Mode shows it, editable in place. */
export function PointTable({ graph, selected, dispatch }: Props) {
  const t = useStrings()

  /** A 0–1 coordinate as MA's Table Mode shows it (0–100, two decimals). */
  const shown = (v: number) => Number(formatCoord(v))

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
                <NumberField
                  label={`${axis.toUpperCase()} ${i + 1}`}
                  value={shown(p[axis])}
                  min={0}
                  max={100}
                  step={0.01}
                  normalize={(v) => shown(roundTyped(v / 100))}
                  onCommit={(v) => dispatch({ type: 'setPoint', index: i, [axis]: v / 100 })}
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
