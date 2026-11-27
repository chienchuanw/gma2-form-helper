import { useRef, useState, type PointerEvent } from 'react'
import { fixtureFrame, type EffectParams } from '../core/effect'
import type { Sample } from '../core/fit'
import { snap, type Form } from '../core/model'
import { useStrings } from '../i18n'
import { PLOT, VIEW_H, VIEW_W, curvePath, fromSvg, nearestPoint, toGraph, toSvg } from './geometry'
import type { Action } from './state'
import { useFrame, type Playback } from './usePlayback'

export interface SnapGrid {
  x: number
  y: number
}

export type Tool = 'edit' | 'draw'

interface Props {
  form: Form
  active: number
  selected: number | null
  grid: SnapGrid | null
  tool: Tool
  dispatch: (a: Action) => void
  /** A finished freehand stroke in 0–1 coordinates (draw tool). */
  onStroke: (samples: Sample[]) => void
  /** The effect preview, marked on the curve: a playhead at fixture 1 and a dot per fixture. */
  preview: { playback: Playback; params: EffectParams }
}

/** Grab radius in screen pixels, so points stay easy to hit on small screens. */
const HIT_PX = 12
const TICKS = Array.from({ length: 11 }, (_, i) => i / 10)
/** One cycle is one bar of four beats: downbeats on 0/25/50/75, upbeats ("&") halfway between. */
const BEATS = [0, 1, 2, 3].map((b) => ({ n: b + 1, x: b / 4 }))

export function GraphCanvas({ form, active, selected, grid, tool, dispatch, onStroke, preview }: Props) {
  const t = useStrings()
  const svgRef = useRef<SVGSVGElement>(null)
  /** pointerId of the pointer dragging a point or drawing, or null. */
  const dragging = useRef<number | null>(null)
  const [stroke, setStroke] = useState<Sample[] | null>(null)
  /** The stroke being drawn, read on pointer-up without waiting for a re-render. */
  const strokeRef = useRef<Sample[] | null>(null)
  const setStrokeBoth = (s: Sample[] | null) => {
    strokeRef.current = s
    setStroke(s)
  }
  const graph = form.graphs[active]

  const playhead = useRef<SVGLineElement>(null)
  const dots = useRef<(SVGCircleElement | null)[]>([])
  useFrame(preview.playback, (pos) => {
    const frame = fixtureFrame(graph, pos, preview.params)
    if (frame.length > 0) {
      const x = toSvg(frame[0].x, 0)[0].toFixed(1)
      playhead.current?.setAttribute('x1', x)
      playhead.current?.setAttribute('x2', x)
    }
    frame.forEach((f, i) => {
      const [cx, cy] = toSvg(f.x, f.value)
      dots.current[i]?.setAttribute('cx', cx.toFixed(1))
      dots.current[i]?.setAttribute('cy', cy.toFixed(1))
    })
  })

  const toView = (e: PointerEvent): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * VIEW_W, ((e.clientY - r.top) / r.height) * VIEW_H]
  }
  const snapped = (sx: number, sy: number): [number, number] => {
    const [x, y] = fromSvg(sx, sy)
    return grid ? [snap(x, grid.x), snap(y, grid.y)] : [x, y]
  }

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button > 0 || e.isPrimary === false) return // ignore right-clicks and extra fingers
    // Commit a value still being typed in the table before rows can shift.
    const focused = document.activeElement
    if (focused instanceof HTMLInputElement) focused.blur()
    const [sx, sy] = toView(e)
    if (tool === 'draw') {
      dragging.current = e.pointerId
      const [x, y] = toGraph(sx, sy) // unclamped: the fitter cuts the stroke at the edges
      setStrokeBoth([{ x, y }])
      capture(e)
      return
    }
    const width = svgRef.current!.getBoundingClientRect().width || VIEW_W
    const hit = nearestPoint(graph, sx, sy, Math.max(8, (HIT_PX * VIEW_W) / width))
    if (hit === null) {
      const [x, y] = snapped(sx, sy)
      dispatch({ type: 'addPoint', x, y })
      return
    }
    dispatch({ type: 'beginDrag', index: hit })
    dragging.current = e.pointerId
    capture(e)
  }

  // The reducer moves whichever point is selected, so fast moves never hit a stale index.
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (dragging.current !== e.pointerId) return
    if (tool === 'draw') {
      const [x, y] = toGraph(...toView(e))
      setStrokeBoth([...(strokeRef.current ?? []), { x, y }])
      return
    }
    const [x, y] = snapped(...toView(e))
    dispatch({ type: 'dragTo', x, y })
  }

  const endDrag = (e: PointerEvent<SVGSVGElement>) => {
    if (dragging.current !== e.pointerId) return
    dragging.current = null
    if (tool === 'draw') {
      // A cancelled pointer (e.g. the browser took over the gesture) draws nothing.
      if (strokeRef.current && e.type !== 'pointercancel') onStroke(strokeRef.current)
      setStrokeBoth(null)
      return
    }
    dispatch({ type: 'endDrag' })
  }

  // Major lines every 10 (with labels); the snap grid, where it differs, as faint minor lines.
  const minorXs = grid ? steps(grid.x).filter((x) => !onTick(x)) : []
  const minorYs = grid ? steps(grid.y).filter((y) => !onTick(y)) : []

  return (
    <svg
      ref={svgRef}
      className={tool === 'draw' ? 'graph drawing' : 'graph'}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="application"
      aria-label={t.canvasLabel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <defs>
        <clipPath id="plot-area">
          <rect x={PLOT.left} y={PLOT.top} width={PLOT.width} height={PLOT.height} />
        </clipPath>
      </defs>
      <rect className="plot-bg" x={PLOT.left} y={PLOT.top} width={PLOT.width} height={PLOT.height} />
      {BEATS.filter((b) => b.n % 2 === 0).map((b) => (
        <rect key={`shade${b.n}`} className="beat-shade" x={toSvg(b.x, 0)[0]} y={PLOT.top} width={PLOT.width / 4} height={PLOT.height} />
      ))}
      {minorXs.map((x) => (
        <line key={`mx${x}`} className="grid-line minor" x1={toSvg(x, 0)[0]} x2={toSvg(x, 0)[0]} y1={PLOT.top} y2={PLOT.top + PLOT.height} />
      ))}
      {minorYs.map((y) => (
        <line key={`my${y}`} className="grid-line minor" y1={toSvg(0, y)[1]} y2={toSvg(0, y)[1]} x1={PLOT.left} x2={PLOT.left + PLOT.width} />
      ))}
      {TICKS.map((v) => (
        <g key={`g${v}`}>
          <line className="grid-line" x1={toSvg(v, 0)[0]} x2={toSvg(v, 0)[0]} y1={PLOT.top} y2={PLOT.top + PLOT.height} />
          <line className="grid-line" y1={toSvg(0, v)[1]} y2={toSvg(0, v)[1]} x1={PLOT.left} x2={PLOT.left + PLOT.width} />
        </g>
      ))}
      {BEATS.map((b) => {
        const down = toSvg(b.x, 0)[0]
        const up = toSvg(b.x + 1 / 8, 0)[0]
        return (
          <g key={`beat${b.n}`} aria-hidden="true">
            <line className="beat-line downbeat" x1={down} x2={down} y1={PLOT.top} y2={PLOT.top + PLOT.height} />
            <line className="beat-line upbeat" x1={up} x2={up} y1={PLOT.top} y2={PLOT.top + PLOT.height} />
            <text className="beat-label downbeat" x={down + 6} y={PLOT.top + 16}>
              {b.n}
            </text>
            <text className="beat-label upbeat" x={up + 6} y={PLOT.top + 16}>
              &amp;
            </text>
          </g>
        )
      })}
      {TICKS.map((v) => (
        <g key={`t${v}`} className="tick">
          <text x={toSvg(v, 0)[0]} y={PLOT.top + PLOT.height + 22} textAnchor="middle">
            {Math.round(v * 100)}
          </text>
          <text x={PLOT.left - 8} y={toSvg(0, v)[1] + 4} textAnchor="end">
            {Math.round(v * 100)}
          </text>
        </g>
      ))}
      <g clipPath="url(#plot-area)">
        {form.graphs.map((g, i) =>
          i === active ? null : <path key={i} className="curve other" d={curvePath(g)} stroke={`#${g.color}`} />,
        )}
        <path className="curve active" d={curvePath(graph)} stroke={`#${graph.color}`} />
      </g>
      <g className="preview-marks" aria-hidden="true">
        <line ref={playhead} className="playhead" y1={PLOT.top} y2={PLOT.top + PLOT.height} />
        <g clipPath="url(#plot-area)">
          {Array.from({ length: preview.params.count }, (_, i) => (
            <circle key={i} ref={(el) => void (dots.current[i] = el)} className={i === 0 ? 'fixture-dot first' : 'fixture-dot'} r={i === 0 ? 5 : 4} />
          ))}
        </g>
      </g>
      {stroke && (
        <polyline
          className="stroke"
          points={stroke.map((p) => toSvg(p.x, p.y).map((v) => v.toFixed(1)).join(',')).join(' ')}
        />
      )}
      {graph.points.map((p, i) => {
        const [cx, cy] = toSvg(p.x, p.y)
        return <circle key={i} className={i === selected ? 'point selected' : 'point'} cx={cx} cy={cy} r={i === selected ? 8 : 6} />
      })}
    </svg>
  )
}

/** Keep receiving moves outside the SVG; harmless if the pointer cannot be captured. */
function capture(e: PointerEvent<SVGSVGElement>) {
  try {
    e.currentTarget.setPointerCapture?.(e.pointerId)
  } catch {
    // e.g. the pointer is already gone
  }
}

const onTick = (v: number) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-6

function steps(step: number): number[] {
  const out: number[] = []
  for (let v = 0; v <= 1 + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out
}
