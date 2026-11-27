import { useRef } from 'react'
import { LIMITS, PHASE_PRESETS, fixtureFrame, maEffectSpeed, type EffectParams, type PreviewSettings } from '../core/effect'
import type { Graph } from '../core/model'
import { useStrings } from '../i18n'
import { PLOT, toSvg } from './geometry'
import { NumberField } from './NumberField'
import { useFrame, type Playback } from './usePlayback'

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
      // The tooltip only matters when the strip holds still.
      if (!playback.playing) el.title = t.fixtureTitle(i + 1, show(f.phase), String(Math.round(f.level)))
    })
  })

  const field = (label: string, key: keyof PreviewSettings, limits: readonly [number, number], integer = false) => (
    <NumberField
      label={label}
      className="num-field"
      value={settings[key]}
      min={limits[0]}
      max={limits[1]}
      step={integer ? 1 : 'any'}
      normalize={integer ? Math.round : undefined}
      onCommit={(v) => set({ [key]: v })}
    />
  )

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
          {field(t.tempo, 'bpm', LIMITS.bpm)}
        </label>
        <span className="inline">
          {t.fixtures}
          <button type="button" className="icon" aria-label={t.fewerFixtures} title={t.fewerFixtures} disabled={count <= LIMITS.count[0]} onClick={() => set({ count: count - 1 })}>
            −
          </button>
          {field(t.fixtures, 'count', LIMITS.count, true)}
          <button type="button" className="icon" aria-label={t.moreFixtures} title={t.moreFixtures} disabled={count >= LIMITS.count[1]} onClick={() => set({ count: count + 1 })}>
            +
          </button>
        </span>
      </div>
      <div className="toolbar">
        <span className="inline">
          {t.phase}
          {field(t.phaseStart, 'phaseStart', LIMITS.phase)}
          <span aria-hidden="true">→</span>
          {field(t.phaseEnd, 'phaseEnd', LIMITS.phase)}
          {PHASE_PRESETS.map(([from, to]) => (
            <button key={`${from}${to}`} type="button" className="icon" aria-label={t.phasePreset(fmt(from), fmt(to))} onClick={() => set({ phaseStart: from, phaseEnd: to })}>
              {from === to ? show(from) : `${show(from)} → ${show(to)}`}
            </button>
          ))}
        </span>
        <label className="inline">
          {t.low}
          {field(t.low, 'low', LIMITS.level)}
        </label>
        <label className="inline">
          {t.high}
          {field(t.high, 'high', LIMITS.level)}
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

interface MarksProps {
  graph: Graph
  params: EffectParams
  playback: Playback
}

/** For GraphCanvas: a playhead at fixture 1 and a dot per fixture where it is on the curve. */
export function PreviewMarks({ graph, params, playback }: MarksProps) {
  const playhead = useRef<SVGLineElement>(null)
  const dots = useRef<(SVGCircleElement | null)[]>([])

  useFrame(playback, (pos) => {
    fixtureFrame(graph, pos, params).forEach((f, i) => {
      const [cx, cy] = toSvg(f.x, f.value)
      if (i === 0) {
        playhead.current?.setAttribute('x1', cx.toFixed(1))
        playhead.current?.setAttribute('x2', cx.toFixed(1))
      }
      dots.current[i]?.setAttribute('cx', cx.toFixed(1))
      dots.current[i]?.setAttribute('cy', cy.toFixed(1))
    })
  })

  return (
    <g className="preview-marks" aria-hidden="true">
      <line ref={playhead} className="playhead" y1={PLOT.top} y2={PLOT.top + PLOT.height} />
      <g clipPath="url(#plot-area)">
        {Array.from({ length: params.count }, (_, i) => (
          <circle key={i} ref={(el) => void (dots.current[i] = el)} className={i === 0 ? 'fixture-dot first' : 'fixture-dot'} r={i === 0 ? 5 : 4} />
        ))}
      </g>
    </g>
  )
}
