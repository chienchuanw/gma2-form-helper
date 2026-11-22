import { drawable } from '../core/fit'
import { roundCoord, roundTyped, sortPoints, type Form, type Graph, type Mode, type Point } from '../core/model'

export interface EditorState {
  form: Form
  /** Index of the graph being edited. */
  active: number
  /** Index of the selected point in the active graph. */
  selected: number | null
}

export interface History {
  past: EditorState[]
  present: EditorState
  future: EditorState[]
  /** State before the current drag; pushed to past on the first real move. */
  dragStart?: EditorState
  /** Kind of the last recorded edit, so a run of the same continuous edit is one undo step. */
  lastKind?: string
  /** A point is being dragged: undo/redo wait until it is released. */
  dragging?: boolean
}

export type Action =
  | { type: 'load'; form: Form }
  | { type: 'addPoint'; x: number; y: number }
  | { type: 'movePoint'; index: number; x: number; y: number }
  | { type: 'setPoint'; index: number; x?: number; y?: number; mode?: Mode }
  | { type: 'deletePoint'; index: number }
  | { type: 'select'; index: number | null }
  /** Grab a point: selects it; the drag becomes one undo step once it moves. */
  | { type: 'beginDrag'; index: number }
  /** Move the grabbed (selected) point. */
  | { type: 'dragTo'; x: number; y: number }
  | { type: 'endDrag' }
  | { type: 'nudgePoint'; dx: number; dy: number }
  /**
   * Replace the active graph's points between from and to with a fitted stroke.
   * Re-fitting the same stroke (same id) replaces it without a new undo step.
   */
  | { type: 'drawStroke'; stroke: number; from: number; to: number; points: readonly Point[] }
  | { type: 'setActive'; index: number }
  | { type: 'addGraph' }
  | { type: 'deleteGraph'; index: number }
  | { type: 'renameGraph'; index: number; name: string }
  | { type: 'setGraphColor'; index: number; color: string }
  | { type: 'setFormName'; name: string }
  | { type: 'undo' }
  | { type: 'redo' }

/** Colours offered for new graphs, starting with MA's defaults. */
export const GRAPH_COLORS = ['c0c0c0', '30c0c0', 'ff4040', '40c040', '4080ff', 'ffc040', 'c060ff']

export function newForm(): Form {
  return {
    name: 'Form',
    display2d: false,
    graphs: [
      {
        color: GRAPH_COLORS[0],
        points: [
          { x: 0, y: 0, mode: 'linear' },
          { x: 0.5, y: 1, mode: 'linear' },
        ],
      },
    ],
  }
}

export function initialState(): History {
  return { past: [], present: { form: newForm(), active: 0, selected: null }, future: [] }
}

export function reducer(h: History, action: Action): History {
  const next = apply(h, action)
  // Anything but another step of the same continuous edit ends that edit's run.
  if (next.lastKind !== undefined && next === h) return next
  if (next.lastKind !== undefined && coalesceKind(action) !== next.lastKind) return { ...next, lastKind: undefined }
  return next
}

function apply(h: History, action: Action): History {
  const s = h.present
  if (h.dragging && (action.type === 'undo' || action.type === 'redo')) return h
  switch (action.type) {
    case 'load':
      return record(h, { form: action.form, active: 0, selected: null })
    case 'undo':
      if (h.past.length === 0) return h
      return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [s, ...h.future] }
    case 'redo':
      if (h.future.length === 0) return h
      return { past: [...h.past, s], present: h.future[0], future: h.future.slice(1) }
    case 'beginDrag': {
      const present = { ...s, selected: action.index }
      return { ...h, present, dragStart: present, dragging: true }
    }
    case 'dragTo': {
      if (s.selected === null) return h
      const next = edit(s, { type: 'movePoint', index: s.selected, x: action.x, y: action.y })
      if (next === s) return h
      if (!h.dragStart) return { ...h, present: next }
      return { past: [...h.past, h.dragStart], present: next, future: [], dragging: true }
    }
    case 'drawStroke':
      // A re-fit of the latest stroke starts from the graph as it was before
      // the stroke, so it matches a fresh fit at the new precision.
      if (isLatestStroke(h, action.stroke) && h.past.length > 0) {
        const base = h.past[h.past.length - 1]
        return record(h, edit({ ...base, active: s.active }, action), coalesceKind(action))
      }
      return record(h, edit(s, action), coalesceKind(action))
    case 'endDrag':
      return { past: h.past, present: s, future: h.future }
    case 'select':
      return { ...h, present: { ...s, selected: action.index } }
    case 'setActive':
      return { ...h, present: { ...s, active: action.index, selected: null } }
    default:
      return record(h, edit(s, action), coalesceKind(action))
  }
}

/** True while the given stroke is still the latest edit, so it can be re-fitted in place. */
export function isLatestStroke(h: History, stroke: number): boolean {
  return h.lastKind === `stroke:${stroke}`
}

/** Edits that arrive in a continuous stream (typing a name, dragging a colour picker). */
function coalesceKind(action: Action): string | undefined {
  if (action.type === 'setFormName') return 'formName'
  if (action.type === 'setGraphColor') return `color:${action.index}`
  if (action.type === 'drawStroke') return `stroke:${action.stroke}`
  return undefined
}

/**
 * Push the present onto the undo stack, unless only the selection or active tab
 * changed, or this continues a run of the same continuous edit.
 */
function record(h: History, next: EditorState, kind?: string): History {
  if (next === h.present) return { ...h, dragStart: undefined }
  if (next.form === h.present.form) return { ...h, present: next, dragStart: undefined }
  if (kind !== undefined && kind === h.lastKind) return { ...h, present: next, future: [], lastKind: kind }
  return { past: [...h.past, h.present], present: next, future: [], lastKind: kind }
}

function edit(s: EditorState, action: Action): EditorState {
  const graph = s.form.graphs[s.active]
  switch (action.type) {
    case 'addPoint': {
      const x = roundCoord(action.x)
      const y = roundCoord(action.y)
      // A click that lands exactly on a point (e.g. snapped onto it) selects it.
      const existing = graph.points.findIndex((q) => q.x === x && q.y === y)
      if (existing !== -1) return { ...s, selected: existing }
      const p: Point = { x, y, mode: modeAt(graph, action.x) }
      return withPoints(s, [...graph.points, p], p)
    }
    case 'movePoint': {
      const old = graph.points[action.index]
      if (!old) return s
      const p: Point = { ...old, x: roundCoord(action.x), y: roundCoord(action.y) }
      if (p.x === old.x && p.y === old.y) return s
      return withPoints(s, graph.points.map((q, i) => (i === action.index ? p : q)), p)
    }
    case 'nudgePoint': {
      const old = s.selected === null ? undefined : graph.points[s.selected]
      if (!old) return s
      const p: Point = { ...old, x: roundCoord(old.x + action.dx), y: roundCoord(old.y + action.dy) }
      if (p.x === old.x && p.y === old.y) return s
      return withPoints(s, graph.points.map((q) => (q === old ? p : q)), p)
    }
    case 'setPoint': {
      const old = graph.points[action.index]
      if (!old) return s
      const p: Point = {
        x: action.x === undefined ? old.x : roundTyped(action.x),
        y: action.y === undefined ? old.y : roundTyped(action.y),
        mode: action.mode ?? old.mode,
      }
      if (p.x === old.x && p.y === old.y && p.mode === old.mode) return s
      return withPoints(s, graph.points.map((q, i) => (i === action.index ? p : q)), p)
    }
    case 'drawStroke': {
      // Cover where the fitted points actually landed too (snapping can move them past the stroke).
      const from = Math.min(action.from, ...action.points.map((p) => p.x))
      const to = Math.max(action.to, ...action.points.map((p) => p.x))
      const kept = graph.points.filter((p) => p.x < from - 1e-9 || p.x > to + 1e-9)
      const points = drawable(sortPoints([...kept, ...action.points]))
      return { ...withGraph(s, s.active, { ...graph, points }), selected: null }
    }
    case 'deletePoint':
      return {
        ...withGraph(s, s.active, { ...graph, points: graph.points.filter((_, i) => i !== action.index) }),
        selected: null,
      }
    case 'addGraph': {
      const color = GRAPH_COLORS[s.form.graphs.length % GRAPH_COLORS.length]
      const graphs = [...s.form.graphs, { color, points: [{ x: 0, y: 0, mode: 'linear' as Mode }] }]
      return { form: { ...s.form, graphs }, active: graphs.length - 1, selected: null }
    }
    case 'deleteGraph': {
      if (s.form.graphs.length <= 1) return s
      const graphs = s.form.graphs.filter((_, i) => i !== action.index)
      return { form: { ...s.form, graphs }, active: Math.min(s.active, graphs.length - 1), selected: null }
    }
    case 'renameGraph': {
      const g = s.form.graphs[action.index]
      const name = action.name.trim() || undefined
      if (name === g.name) return s
      return withGraph(s, action.index, { ...g, name })
    }
    case 'setGraphColor': {
      const g = s.form.graphs[action.index]
      if (action.color === g.color) return s
      return withGraph(s, action.index, { ...g, color: action.color })
    }
    case 'setFormName':
      if (action.name === s.form.name) return s
      return { ...s, form: { ...s.form, name: action.name } }
    default:
      return s
  }
}

/** The mode of the segment containing x, i.e. of the last point at or before it (wrapping). */
function modeAt(graph: Graph, x: number): Mode {
  const pts = graph.points
  if (pts.length === 0) return 'linear'
  const i = pts.findLastIndex((p) => p.x <= x)
  return pts[i === -1 ? pts.length - 1 : i].mode
}

/** Replace the active graph's points (re-sorted) and select `focus`. */
function withPoints(s: EditorState, points: readonly Point[], focus: Point): EditorState {
  const sorted = sortPoints(points)
  const next = withGraph(s, s.active, { ...s.form.graphs[s.active], points: sorted })
  return { ...next, selected: sorted.indexOf(focus) }
}

function withGraph(s: EditorState, index: number, graph: Graph): EditorState {
  return { ...s, form: { ...s.form, graphs: s.form.graphs.map((g, i) => (i === index ? graph : g)) } }
}
