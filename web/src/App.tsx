import { useEffect, useReducer, useRef, useState, type ChangeEvent } from 'react'
import { analyzeGraph } from './core/evaluate'
import { fitStroke, precisionToTolerance, strokeSpan, type FitMode, type Sample } from './core/fit'
import type { Form } from './core/model'
import { MODE_LABELS, tableText } from './core/table'
import { DEFAULT_VERSION, exportFileName, parseFormsXml, serializeFormsXml } from './core/xml'
import { FormPicker } from './editor/FormPicker'
import { GraphCanvas, type SnapGrid, type Tool } from './editor/GraphCanvas'
import { GraphTabs } from './editor/GraphTabs'
import { ModeSelect } from './editor/ModeSelect'
import { PointTable } from './editor/PointTable'
import { initialState, isLatestStroke, reducer } from './editor/state'
import { LangContext, STRINGS, detectLang, type Lang } from './i18n'

/** Versions whose import has been verified on a console or onPC. */
const VERSIONS = [DEFAULT_VERSION]
const SNAP: SnapGrid = { x: 0.125, y: 0.1 }

export default function App() {
  const [lang, setLang] = useState<Lang>(() => detectLang(navigator.languages ?? []))
  const [history, dispatch] = useReducer(reducer, undefined, initialState)
  const [snapOn, setSnapOn] = useState(true)
  const [tool, setTool] = useState<Tool>('edit')
  const [precision, setPrecision] = useState(5)
  const [drawMode, setDrawMode] = useState<FitMode>('auto')
  /** The last freehand stroke, so the precision slider can re-fit it. */
  const lastStroke = useRef<{ id: number; samples: Sample[] } | null>(null)
  const [version, setVersion] = useState(DEFAULT_VERSION)
  const [choices, setChoices] = useState<Form[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'idle' | 'ok' | 'failed'>('idle')
  const t = STRINGS[lang]

  const { form, active, selected } = history.present
  const graph = form.graphs[active]
  const analysis = analyzeGraph(graph)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  // Registered once; reads the current selection through a ref.
  const selectedRef = useRef(selected)
  useEffect(() => {
    selectedRef.current = selected
  }, [selected])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return
      if (document.querySelector('dialog[open]')) return
      const mod = e.metaKey || e.ctrlKey
      const sel = selectedRef.current
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' })
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        dispatch({ type: 'redo' })
      } else if (sel !== null && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        dispatch({ type: 'deletePoint', index: sel })
      } else if (sel !== null && e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 0.01 : 0.001
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowDown' ? -step : e.key === 'ArrowUp' ? step : 0
        dispatch({ type: 'nudgePoint', dx, dy })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const fitInto = (id: number, samples: Sample[], p: number, mode: FitMode) => {
    const span = strokeSpan(samples)
    const points = fitStroke(samples, { tolerance: precisionToTolerance(p), grid: snapOn ? SNAP : null, mode })
    if (!span || points.length === 0) return
    dispatch({ type: 'drawStroke', stroke: id, ...span, points })
  }

  const onStroke = (samples: Sample[]) => {
    const id = (lastStroke.current?.id ?? 0) + 1
    lastStroke.current = { id, samples }
    fitInto(id, samples, precision, drawMode)
  }

  // Re-fit the last stroke with new settings, but only while it is still the latest edit.
  const refit = (p: number, mode: FitMode) => {
    const last = lastStroke.current
    if (last && isLatestStroke(history, last.id)) fitInto(last.id, last.samples, p, mode)
  }

  const onPrecision = (p: number) => {
    setPrecision(p)
    refit(p, drawMode)
  }

  const onDrawMode = (mode: FitMode) => {
    setDrawMode(mode)
    refit(precision, mode)
  }

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      // A Form needs at least one graph to be edited (and MA always writes one).
      const forms = parseFormsXml(await file.text()).filter((f) => f.graphs.length > 0)
      if (forms.length === 0) throw new Error(t.noForms)
      setError(null)
      if (forms.length === 1) dispatch({ type: 'load', form: forms[0] })
      else setChoices(forms)
    } catch (err) {
      setError(`${t.importError} ${(err as Error).message}`)
    }
  }

  const onExport = () => {
    const blob = new Blob([serializeFormsXml([form], { version })], { type: 'application/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = exportFileName(form.name)
    a.click()
    // Revoking right away can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(tableText(form))
      setCopied('ok')
    } catch {
      setCopied('failed')
    }
    setTimeout(() => setCopied('idle'), 1500)
  }

  return (
    <LangContext.Provider value={lang}>
      <header className="app-header">
        <div>
          <h1>{t.appTitle}</h1>
          <p className="muted">{t.tagline}</p>
        </div>
        <label className="inline">
          {t.language}
          <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            <option value="en">English</option>
            <option value="zh-TW">繁體中文</option>
          </select>
        </label>
      </header>

      <div className="toolbar">
        <label className="inline">
          {t.formName}
          <input value={form.name} onChange={(e) => dispatch({ type: 'setFormName', name: e.target.value })} />
        </label>
        <label className="button">
          {t.importXml}
          <input type="file" accept=".xml,text/xml,application/xml" className="visually-hidden" onChange={onImport} />
        </label>
        <label className="inline">
          {t.exportVersion}
          <select value={version} onChange={(e) => setVersion(e.target.value)}>
            {VERSIONS.map((v) => (
              <option key={v} value={v}>
                grandMA2 {v}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="primary" onClick={onExport}>
          {t.exportXml}
        </button>
      </div>

      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}

      <main className="workspace">
        <section className="editor">
          <div className="toolbar">
            <div className="segmented" role="group" aria-label={t.tool}>
              <button type="button" aria-pressed={tool === 'edit'} onClick={() => setTool('edit')}>
                {t.toolEdit}
              </button>
              <button type="button" aria-pressed={tool === 'draw'} onClick={() => setTool('draw')}>
                {t.toolDraw}
              </button>
            </div>
            {tool === 'draw' && (
              <label className="inline" title={t.drawModeHelp}>
                {t.drawMode}
                <select value={drawMode} onChange={(e) => onDrawMode(e.target.value as FitMode)}>
                  <option value="auto">{t.drawModeAuto}</option>
                  <option value="linear">{MODE_LABELS.linear}</option>
                  <option value="spline">{MODE_LABELS.spline}</option>
                  <option value="step">{MODE_LABELS.step_end}</option>
                </select>
              </label>
            )}
            <label className="inline" title={t.precisionHelp}>
              {t.precision}
              <input type="range" min={1} max={10} step={1} value={precision} onChange={(e) => onPrecision(Number(e.target.value))} />
            </label>
            <button type="button" disabled={history.past.length === 0} onClick={() => dispatch({ type: 'undo' })}>
              {t.undo}
            </button>
            <button type="button" disabled={history.future.length === 0} onClick={() => dispatch({ type: 'redo' })}>
              {t.redo}
            </button>
            <label className="inline">
              <input type="checkbox" checked={snapOn} onChange={(e) => setSnapOn(e.target.checked)} />
              {t.snap}
            </label>
            <label className="inline">
              {t.selectedMode}
              <ModeSelect
                label={t.selectedMode}
                disabled={selected === null}
                value={selected === null ? null : (graph.points[selected]?.mode ?? null)}
                onChange={(mode) => selected !== null && dispatch({ type: 'setPoint', index: selected, mode })}
              />
            </label>
          </div>
          <GraphCanvas
            form={form}
            active={active}
            selected={selected}
            grid={snapOn ? SNAP : null}
            tool={tool}
            dispatch={dispatch}
            onStroke={onStroke}
          />
          <p className="muted hint">{tool === 'draw' ? t.drawHint : t.canvasHint}</p>
          <GraphTabs form={form} active={active} dispatch={dispatch} />
          <div role="status" className="notices">
            {analysis.approximate && <p className="notice">{t.approximate}</p>}
            {analysis.warnings.map((w) => (
              <p key={w} className="notice warn">
                {t.warnings[w]}
              </p>
            ))}
          </div>
        </section>

        <aside className="values">
          <div className="toolbar">
            <h2>{t.points}</h2>
            <button type="button" onClick={onCopy}>
              {copied === 'ok' ? t.copied : copied === 'failed' ? t.copyFailed : t.copyTable}
            </button>
          </div>
          <p className="muted">{t.tableHelp}</p>
          <PointTable graph={graph} selected={selected} dispatch={dispatch} />
        </aside>
      </main>

      {choices && (
        <FormPicker
          forms={choices}
          onPick={(f) => {
            dispatch({ type: 'load', form: f })
            setChoices(null)
          }}
          onCancel={() => setChoices(null)}
        />
      )}
    </LangContext.Provider>
  )
}
