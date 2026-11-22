import { describe, expect, it } from 'vitest'
import type { Form } from '../core/model'
import { initialState, reducer, type History } from './state'

const form = (): Form => ({
  name: 'T',
  display2d: false,
  graphs: [
    {
      color: 'c0c0c0',
      points: [
        { x: 0, y: 0, mode: 'linear' },
        { x: 0.5, y: 1, mode: 'spline' },
      ],
    },
  ],
})

const start = (): History => ({ ...reducer(initialState(), { type: 'load', form: form() }), past: [] })
const pts = (h: History) => h.present.form.graphs[h.present.active].points

describe('editor reducer', () => {
  it('adds a point, rounded, inheriting the mode of the segment it lands in, and selects it', () => {
    const h = reducer(start(), { type: 'addPoint', x: 0.71234, y: 0.33333 })

    expect(pts(h)).toEqual([
      { x: 0, y: 0, mode: 'linear' },
      { x: 0.5, y: 1, mode: 'spline' },
      { x: 0.712, y: 0.333, mode: 'spline' },
    ])
    expect(h.present.selected).toBe(2)
  })

  it('moves a point, keeps points sorted and follows the selection', () => {
    let h = reducer(start(), { type: 'addPoint', x: 0.8, y: 0.2 })
    h = reducer(h, { type: 'movePoint', index: 2, x: 0.25, y: 0.5 })

    expect(pts(h).map((p) => p.x)).toEqual([0, 0.25, 0.5])
    expect(h.present.selected).toBe(1)
  })

  it('clamps moved points into 0–1', () => {
    const h = reducer(start(), { type: 'movePoint', index: 1, x: 1.4, y: -0.2 })

    expect(pts(h)[1]).toMatchObject({ x: 1, y: 0 })
  })

  it('edits a point from the table with two-decimal precision on the 0–100 scale', () => {
    const h = reducer(start(), { type: 'setPoint', index: 1, x: 0.123456, mode: 'step_end' })

    expect(pts(h)[1]).toEqual({ x: 0.1235, y: 1, mode: 'step_end' })
  })

  it('deletes a point and clears the selection', () => {
    let h = reducer(start(), { type: 'select', index: 1 })
    h = reducer(h, { type: 'deletePoint', index: 1 })

    expect(pts(h)).toHaveLength(1)
    expect(h.present.selected).toBeNull()
  })

  it('undoes and redoes edits', () => {
    let h = reducer(start(), { type: 'addPoint', x: 0.8, y: 0.2 })
    h = reducer(h, { type: 'undo' })
    expect(pts(h)).toHaveLength(2)
    h = reducer(h, { type: 'redo' })
    expect(pts(h)).toHaveLength(3)
  })

  it('nudges the selected point', () => {
    let h = reducer(start(), { type: 'select', index: 1 })
    h = reducer(h, { type: 'nudgePoint', dx: -0.01, dy: -0.1 })

    expect(pts(h)[1]).toMatchObject({ x: 0.49, y: 0.9 })
    expect(reducer(reducer(start(), { type: 'select', index: null }), { type: 'nudgePoint', dx: 1, dy: 0 }).past).toHaveLength(0)
  })

  it('does not record a table edit that changes nothing', () => {
    const h = reducer(start(), { type: 'setPoint', index: 1, x: 0.5 })

    expect(h.past).toHaveLength(0)
  })

  it('records a whole drag as one undo step', () => {
    let h = reducer(start(), { type: 'beginDrag', index: 1 })
    expect(h.present.selected).toBe(1)
    h = reducer(h, { type: 'dragTo', x: 0.4, y: 0.9 })
    h = reducer(h, { type: 'dragTo', x: 0.3, y: 0.8 })
    h = reducer(h, { type: 'endDrag' })
    expect(pts(h)[1]).toMatchObject({ x: 0.3, y: 0.8 })

    h = reducer(h, { type: 'undo' })
    expect(pts(h)[1]).toMatchObject({ x: 0.5, y: 1 })
  })

  it('keeps dragging the same point when it passes a neighbour', () => {
    let h = reducer(start(), { type: 'addPoint', x: 0.75, y: 0.5 })
    h = reducer(h, { type: 'beginDrag', index: 1 }) // the point at x = 0.5
    h = reducer(h, { type: 'dragTo', x: 0.9, y: 0.2 }) // passes x = 0.75
    h = reducer(h, { type: 'dragTo', x: 0.95, y: 0.1 })

    expect(pts(h).map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [0.75, 0.5],
      [0.95, 0.1],
    ])
  })

  it('does not record an undo step for grabbing a point without moving it', () => {
    let h = reducer(start(), { type: 'beginDrag', index: 1 })
    h = reducer(h, { type: 'endDrag' })

    expect(h.past).toHaveLength(0)
    expect(h.present.selected).toBe(1)
  })

  it('selects an existing point instead of stacking a duplicate on it', () => {
    const h = reducer(start(), { type: 'addPoint', x: 0.5, y: 1 })

    expect(pts(h)).toHaveLength(2)
    expect(h.present.selected).toBe(1)
    expect(h.past).toHaveLength(0)
  })

  it('records a run of colour or form-name edits as one undo step', () => {
    let h = reducer(start(), { type: 'setFormName', name: 'Ta' })
    h = reducer(h, { type: 'setFormName', name: 'Tab' })
    h = reducer(h, { type: 'setGraphColor', index: 0, color: '111111' })
    h = reducer(h, { type: 'setGraphColor', index: 0, color: '222222' })

    expect(h.past).toHaveLength(2)
    h = reducer(h, { type: 'undo' })
    expect(h.present.form.graphs[0].color).toBe('c0c0c0')
    expect(h.present.form.name).toBe('Tab')
  })

  it('starts a new undo step for a name edit after something else happened', () => {
    let h = reducer(start(), { type: 'setFormName', name: 'A' })
    h = reducer(h, { type: 'select', index: 0 })
    h = reducer(h, { type: 'setFormName', name: 'AB' })

    expect(h.past).toHaveLength(2)
  })

  it('ignores undo and redo while a point is being dragged', () => {
    let h = reducer(start(), { type: 'addPoint', x: 0.8, y: 0.2 })
    h = reducer(h, { type: 'beginDrag', index: 1 })
    h = reducer(h, { type: 'dragTo', x: 0.3, y: 0.3 })
    const during = reducer(h, { type: 'undo' })

    expect(during).toBe(h)
    h = reducer(reducer(h, { type: 'endDrag' }), { type: 'undo' })
    expect(pts(h)[1]).toMatchObject({ x: 0.5, y: 1 })
  })

  it('replaces the drawn span with a fitted stroke as one undo step', () => {
    let h = reducer(start(), { type: 'addPoint', x: 0.9, y: 0.4 })
    h = reducer(h, {
      type: 'drawStroke',
      stroke: 1,
      from: 0.2,
      to: 0.6,
      points: [
        { x: 0.2, y: 0.1, mode: 'linear' },
        { x: 0.6, y: 0.7, mode: 'linear' },
      ],
    })

    expect(pts(h).map((p) => p.x)).toEqual([0, 0.2, 0.6, 0.9])
    h = reducer(h, { type: 'undo' })
    expect(pts(h).map((p) => p.x)).toEqual([0, 0.5, 0.9])
  })

  it('also replaces old points where snapped stroke points landed just outside the span', () => {
    let h = reducer(start(), { type: 'addPoint', x: 0.62, y: 0.3 })
    h = reducer(h, { type: 'drawStroke', stroke: 2, from: 0.2, to: 0.6, points: [{ x: 0.25, y: 0.1, mode: 'linear' }, { x: 0.625, y: 0.7, mode: 'linear' }] })

    expect(pts(h).map((p) => p.x)).toEqual([0, 0.25, 0.625])
  })

  it('re-fits the same stroke in place without a new undo step', () => {
    const fit = (y: number) => ({ type: 'drawStroke' as const, stroke: 7, from: 0.2, to: 0.6, points: [{ x: 0.3, y, mode: 'spline' as const }] })
    let h = reducer(start(), fit(0.1))
    h = reducer(h, fit(0.2))

    expect(h.past).toHaveLength(1)
    expect(pts(h).find((p) => p.x === 0.3)?.y).toBe(0.2)
  })

  it('does not record renames or recolours that change nothing', () => {
    let h = reducer(start(), { type: 'renameGraph', index: 0, name: '' })
    h = reducer(h, { type: 'setGraphColor', index: 0, color: 'c0c0c0' })
    h = reducer(h, { type: 'setFormName', name: 'T' })

    expect(h.past).toHaveLength(0)
  })

  it('does not record selection changes in the history', () => {
    let h = reducer(start(), { type: 'select', index: 0 })
    h = reducer(h, { type: 'undo' })

    expect(h.past).toHaveLength(0)
  })

  it('adds, renames, recolours and deletes graphs, never removing the last one', () => {
    let h = reducer(start(), { type: 'addGraph' })
    expect(h.present.form.graphs).toHaveLength(2)
    expect(h.present.active).toBe(1)

    h = reducer(h, { type: 'renameGraph', index: 1, name: 'dimmer' })
    h = reducer(h, { type: 'setGraphColor', index: 1, color: 'ff0000' })
    expect(h.present.form.graphs[1]).toMatchObject({ name: 'dimmer', color: 'ff0000' })

    h = reducer(h, { type: 'deleteGraph', index: 1 })
    h = reducer(h, { type: 'deleteGraph', index: 0 })
    expect(h.present.form.graphs).toHaveLength(1)
    expect(h.present.active).toBe(0)
  })

  it('clears the name when renamed to blank, like an unnamed MA graph', () => {
    const h = reducer(start(), { type: 'renameGraph', index: 0, name: '  ' })

    expect(h.present.form.graphs[0].name).toBeUndefined()
  })

  it('loads a form as an undoable step', () => {
    let h = reducer(start(), { type: 'addPoint', x: 0.8, y: 0.2 })
    h = reducer(h, { type: 'load', form: form() })

    expect(pts(h)).toHaveLength(2)
    expect(h.present.selected).toBeNull()
    h = reducer(h, { type: 'undo' })
    expect(pts(h)).toHaveLength(3)
  })
})
