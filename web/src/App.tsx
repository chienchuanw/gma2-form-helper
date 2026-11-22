import { useEffect, useReducer, useState, type ChangeEvent } from 'react'
import { analyzeGraph, type GraphWarning } from './core/evaluate'
import type { Form } from './core/model'
import { tableText } from './core/table'
import { DEFAULT_VERSION, parseFormsXml, serializeFormsXml } from './core/xml'
import { FormPicker } from './editor/FormPicker'
import { GraphCanvas, type SnapGrid } from './editor/GraphCanvas'
import { GraphTabs } from './editor/GraphTabs'
import { PointTable } from './editor/PointTable'
import { exportFileName } from './editor/geometry'
import { initialState, reducer } from './editor/state'
import { LangContext, STRINGS, detectLang, type Lang } from './i18n'
import { MODES, type Mode } from './core/model'
import { MODE_LABELS } from './core/table'

/** Versions whose import has been verified on a console or onPC. */
const VERSIONS = [DEFAULT_VERSION]
const SNAP: SnapGrid = { x: 0.125, y: 0.1 }

const WARNING_TEXT: Record<GraphWarning, 'warnSplineJump' | 'warnUnpairedBreak' | 'warnOvershoot'> = {
  splineJump: 'warnSplineJump',
  unpairedBreak: 'warnUnpairedBreak',
  overshoot: 'warnOvershoot',
}

export default function App() {
  const [lang, setLang] = useState<Lang>(() => detectLang(navigator.languages ?? []))
  const [history, dispatch] = useReducer(reducer, undefined, initialState)
  const [snapOn, setSnapOn] = useState(true)
  const [version, setVersion] = useState(DEFAULT_VERSION)
  const [choices, setChoices] = useState<Form[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const t = STRINGS[lang]

  const { form, active, selected } = history.present
  const graph = form.graphs[active]
  const analysis = analyzeGraph(graph)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, select, textarea')) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' })
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        dispatch({ type: 'redo' })
      } else if (selected !== null && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        dispatch({ type: 'deletePoint', index: selected })
      } else if (selected !== null && e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 0.01 : 0.001
        const p = graph.points[selected]
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowDown' ? -step : e.key === 'ArrowUp' ? step : 0
        dispatch({ type: 'movePoint', index: selected, x: p.x + dx, y: p.y + dy })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [graph, selected])

  const onImport = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const forms = parseFormsXml(await file.text())
      if (forms.length === 0) throw new Error('no <Form> in file')
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
    URL.revokeObjectURL(url)
  }

  const onCopy = async () => {
    await navigator.clipboard.writeText(tableText(form))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
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
              <select
                disabled={selected === null}
                value={selected === null ? '' : graph.points[selected]?.mode}
                onChange={(e) => selected !== null && dispatch({ type: 'setPoint', index: selected, mode: e.target.value as Mode })}
              >
                {selected === null && <option value="">—</option>}
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <GraphCanvas form={form} active={active} selected={selected} grid={snapOn ? SNAP : null} dispatch={dispatch} />
          <p className="muted hint">{t.canvasHint}</p>
          <GraphTabs form={form} active={active} dispatch={dispatch} />
          <div role="status" className="notices">
            {analysis.approximate && <p className="notice">{t.approximate}</p>}
            {analysis.warnings.map((w) => (
              <p key={w} className="notice warn">
                {t[WARNING_TEXT[w]]}
              </p>
            ))}
          </div>
        </section>

        <aside className="values">
          <div className="toolbar">
            <h2>{t.points}</h2>
            <button type="button" onClick={onCopy}>
              {copied ? t.copied : t.copyTable}
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
