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
}

export type Action =
  | { type: 'load'; form: Form }
  | { type: 'addPoint'; x: number; y: number }
  /** transient: part of a drag already recorded by beginDrag. */
  | { type: 'movePoint'; index: number; x: number; y: number; transient?: boolean }
  | { type: 'setPoint'; index: number; x?: number; y?: number; mode?: Mode }
  | { type: 'deletePoint'; index: number }
  | { type: 'select'; index: number | null }
  /** Select a point and snapshot the history before dragging it. */
  | { type: 'beginDrag'; index: number }
  | { type: 'nudgePoint'; dx: number; dy: number }
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
  const s = h.present
  switch (action.type) {
    case 'load':
      return { past: [], present: { form: action.form, active: 0, selected: null }, future: [] }
    case 'undo':
      if (h.past.length === 0) return h
      return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [s, ...h.future] }
    case 'redo':
      if (h.future.length === 0) return h
      return { past: [...h.past, s], present: h.future[0], future: h.future.slice(1) }
    case 'beginDrag':
      return { past: [...h.past, s], present: { ...s, selected: action.index }, future: [] }
    case 'select':
      return { ...h, present: { ...s, selected: action.index } }
    case 'setActive':
      return { ...h, present: { ...s, active: action.index, selected: null } }
    case 'movePoint':
      return action.transient ? { ...h, present: edit(s, action) } : record(h, edit(s, action))
    default:
      return record(h, edit(s, action))
  }
}

function record(h: History, next: EditorState): History {
  if (next === h.present) return h
  return { past: [...h.past, h.present], present: next, future: [] }
}

function edit(s: EditorState, action: Action): EditorState {
  const graph = s.form.graphs[s.active]
  switch (action.type) {
    case 'addPoint': {
      const p: Point = { x: roundCoord(action.x), y: roundCoord(action.y), mode: modeAt(graph, action.x) }
      return withPoints(s, [...graph.points, p], p)
    }
    case 'movePoint': {
      const old = graph.points[action.index]
      if (!old) return s
      const p: Point = { ...old, x: roundCoord(action.x), y: roundCoord(action.y) }
      return withPoints(s, graph.points.map((q, i) => (i === action.index ? p : q)), p)
    }
    case 'nudgePoint': {
      const old = s.selected === null ? undefined : graph.points[s.selected]
      if (!old) return s
      const p: Point = { ...old, x: roundCoord(old.x + action.dx), y: roundCoord(old.y + action.dy) }
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
      return withGraph(s, action.index, { ...g, name })
    }
    case 'setGraphColor':
      return withGraph(s, action.index, { ...s.form.graphs[action.index], color: action.color })
    case 'setFormName':
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
