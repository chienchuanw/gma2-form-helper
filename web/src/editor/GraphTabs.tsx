import type { Form } from '../core/model'
import { useStrings } from '../i18n'
import type { Action } from './state'

interface Props {
  form: Form
  active: number
  dispatch: (a: Action) => void
}

/** One tab per graph, like MA's Table Mode, plus name and colour of the active graph. */
export function GraphTabs({ form, active, dispatch }: Props) {
  const t = useStrings()
  const graph = form.graphs[active]

  return (
    <div className="graph-tabs">
      <div className="tab-row">
        <div role="tablist" aria-label={t.graphs}>
          {form.graphs.map((g, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={i === active}
              className="tab"
              onClick={() => dispatch({ type: 'setActive', index: i })}
            >
              <span className="swatch" style={{ background: `#${g.color}` }} aria-hidden="true" />
              {i + 1}. {g.name ?? t.unnamed}
            </button>
          ))}
        </div>
        <button type="button" className="tab add" onClick={() => dispatch({ type: 'addGraph' })}>
          + {t.addGraph}
        </button>
      </div>
      <div className="graph-props">
        <label>
          {t.graphName}
          <input
            key={`name${active}:${graph.name ?? ''}`}
            defaultValue={graph.name ?? ''}
            onBlur={(e) => dispatch({ type: 'renameGraph', index: active, name: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
        </label>
        <label>
          {t.graphColor}
          <input
            type="color"
            value={`#${graph.color}`}
            onChange={(e) => dispatch({ type: 'setGraphColor', index: active, color: e.target.value.slice(1) })}
          />
        </label>
        <button type="button" disabled={form.graphs.length <= 1} onClick={() => dispatch({ type: 'deleteGraph', index: active })}>
          {t.deleteGraph}
        </button>
      </div>
    </div>
  )
}
