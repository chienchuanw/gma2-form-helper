import { useRef, useState, type PointerEvent } from 'react'
import type { Form } from '../core/model'
import { useStrings } from '../i18n'
import { PLOT, VIEW_H, VIEW_W, curvePath, fromSvg, nearestPoint, snap, toSvg } from './geometry'
import type { Action } from './state'

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
  onStroke: (samples: { x: number; y: number }[]) => void
}

/** Grab radius in screen pixels, so points stay easy to hit on small screens. */
const HIT_PX = 12
const TICKS = Array.from({ length: 11 }, (_, i) => i / 10)

export function GraphCanvas({ form, active, selected, grid, tool, dispatch, onStroke }: Props) {
  const t = useStrings()
  const svgRef = useRef<SVGSVGElement>(null)
  /** pointerId of the pointer dragging a point or drawing, or null. */
  const dragging = useRef<number | null>(null)
  const [stroke, setStroke] = useState<[number, number][] | null>(null)
  const graph = form.graphs[active]

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
      setStroke([fromSvg(sx, sy)])
      e.currentTarget.setPointerCapture?.(e.pointerId)
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
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }

  // The reducer moves whichever point is selected, so fast moves never hit a stale index.
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (dragging.current !== e.pointerId) return
    if (tool === 'draw') {
      const p = fromSvg(...toView(e))
      setStroke((s) => (s ? [...s, p] : [p]))
      return
    }
    const [x, y] = snapped(...toView(e))
    dispatch({ type: 'dragTo', x, y })
  }

  const endDrag = (e: PointerEvent<SVGSVGElement>) => {
    if (dragging.current !== e.pointerId) return
    dragging.current = null
    if (tool === 'draw') {
      if (stroke) onStroke(stroke.map(([x, y]) => ({ x, y })))
      setStroke(null)
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
      {stroke && (
        <polyline
          className="stroke"
          points={stroke.map(([x, y]) => toSvg(x, y).map((v) => v.toFixed(1)).join(',')).join(' ')}
        />
      )}
      {graph.points.map((p, i) => {
        const [cx, cy] = toSvg(p.x, p.y)
        return <circle key={i} className={i === selected ? 'point selected' : 'point'} cx={cx} cy={cy} r={i === selected ? 8 : 6} />
      })}
    </svg>
  )
}

const onTick = (v: number) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-6

function steps(step: number): number[] {
  const out: number[] = []
  for (let v = 0; v <= 1 + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6)
  return out
}
