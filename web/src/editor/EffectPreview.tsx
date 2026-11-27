import { useRef, type FocusEvent, type KeyboardEvent } from 'react'
import { fixtureFrame, maEffectSpeed, type PreviewSettings } from '../core/effect'
import type { Graph } from '../core/model'
import { useStrings } from '../i18n'
import { useFrame, type Playback } from './usePlayback'

const LIMITS = {
  count: [1, 32],
  bpm: [20, 300],
  phase: [-2880, 2880], // MA's phase range
  level: [0, 100],
} as const

const PRESETS: [number, number][] = [
  [0, -360],
  [0, 360],
  [0, 0],
]

/** Up to two decimals, without trailing zeros; minus signs as typed. */
const fmt = (v: number) => String(Math.round(v * 100) / 100)
/** Display form with a real minus sign. */
const show = (v: number) => fmt(v).replace('-', '−')

interface Props {
  graph: Graph
  settings: PreviewSettings
  onChange: (s: PreviewSettings) => void
  playback: Playback
}

/** A row of fixtures playing the active graph as a dimmer effect. */
export function EffectPreview({ graph, settings, onChange, playback }: Props) {
  const t = useStrings()
  const fixtures = useRef<(HTMLDivElement | null)[]>([])
  const set = (patch: Partial<PreviewSettings>) => onChange({ ...settings, ...patch })
  const { count } = settings

  useFrame(playback, (pos) => {
    fixtureFrame(graph, pos, settings).forEach((f, i) => {
      const el = fixtures.current[i]
      if (!el) return
      el.style.setProperty('--level', (f.level / 100).toFixed(3))
      el.title = t.fixtureTitle(i + 1, show(f.phase), String(Math.round(f.level)))
    })
  })

  return (
    <section className="preview" aria-labelledby="preview-title">
      <div className="toolbar">
        <h2 id="preview-title">{t.preview}</h2>
        <button type="button" className="primary" onClick={playback.toggle}>
          <span aria-hidden="true">{playback.playing ? '❚❚' : '▶'}</span>
          {playback.playing ? t.pause : t.play}
        </button>
        <button type="button" onClick={playback.reset}>
          {t.toStart}
        </button>
        <label className="inline">
          {t.tempo}
          <NumberField label={t.tempo} value={settings.bpm} limits={LIMITS.bpm} onCommit={(bpm) => set({ bpm })} />
        </label>
        <span className="inline">
          {t.fixtures}
          <button type="button" className="icon" aria-label={t.fewerFixtures} title={t.fewerFixtures} disabled={count <= LIMITS.count[0]} onClick={() => set({ count: count - 1 })}>
            −
          </button>
          <NumberField label={t.fixtures} value={count} limits={LIMITS.count} integer onCommit={(c) => set({ count: c })} />
          <button type="button" className="icon" aria-label={t.moreFixtures} title={t.moreFixtures} disabled={count >= LIMITS.count[1]} onClick={() => set({ count: count + 1 })}>
            +
          </button>
        </span>
      </div>
      <div className="toolbar">
        <span className="inline">
          {t.phase}
          <NumberField label={t.phaseStart} value={settings.phaseStart} limits={LIMITS.phase} onCommit={(phaseStart) => set({ phaseStart })} />
          <span aria-hidden="true">→</span>
          <NumberField label={t.phaseEnd} value={settings.phaseEnd} limits={LIMITS.phase} onCommit={(phaseEnd) => set({ phaseEnd })} />
          {PRESETS.map(([from, to]) => (
            <button key={`${from}${to}`} type="button" className="icon" aria-label={t.phasePreset(fmt(from), fmt(to))} onClick={() => set({ phaseStart: from, phaseEnd: to })}>
              {from === to ? show(from) : `${show(from)} → ${show(to)}`}
            </button>
          ))}
        </span>
        <label className="inline">
          {t.low}
          <NumberField label={t.low} value={settings.low} limits={LIMITS.level} onCommit={(low) => set({ low })} />
        </label>
        <label className="inline">
          {t.high}
          <NumberField label={t.high} value={settings.high} limits={LIMITS.level} onCommit={(high) => set({ high })} />
        </label>
      </div>
      <div className="fixtures" aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="fixture" ref={(el) => void (fixtures.current[i] = el)}>
            <span className="lamp" />
            <span className="fixture-num">{i + 1}</span>
          </div>
        ))}
      </div>
      <p className="muted hint">
        {t.previewHint} · {t.speedHint(fmt(maEffectSpeed(settings.bpm)))}
      </p>
      <p className="muted hint">{t.unverified}</p>
    </section>
  )
}

interface FieldProps {
  label: string
  value: number
  limits: readonly [number, number]
  integer?: boolean
  onCommit: (v: number) => void
}

/** A number input that commits on Enter or blur, clamped; a non-number puts the old value back. */
function NumberField({ label, value, limits: [min, max], integer, onCommit }: FieldProps) {
  const commit = (e: FocusEvent<HTMLInputElement> | KeyboardEvent<HTMLInputElement>) => {
    if ('key' in e && e.key !== 'Enter') return
    const input = e.currentTarget
    const v = Number(input.value)
    if (input.value.trim() === '' || !Number.isFinite(v)) {
      input.value = String(value)
      return
    }
    const next = Math.min(max, Math.max(min, integer ? Math.round(v) : v))
    input.value = String(next)
    if (next !== value) onCommit(next)
  }
  return (
    <input
      key={value}
      type="number"
      className="num-field"
      aria-label={label}
      min={min}
      max={max}
      step={integer ? 1 : 'any'}
      defaultValue={value}
      onBlur={commit}
      onKeyDown={commit}
    />
  )
}
