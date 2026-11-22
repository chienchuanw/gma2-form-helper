import { describe, expect, it } from 'vitest'
import type { Graph } from '../core/model'
import { PLOT, curvePoints, exportFileName, fromSvg, nearestPoint, snap, toSvg } from './geometry'

describe('plot mapping', () => {
  it('maps 0–1 graph space to SVG and back', () => {
    const [sx, sy] = toSvg(0.25, 0.75)
    expect(sx).toBe(PLOT.left + 0.25 * PLOT.width)
    expect(sy).toBe(PLOT.top + 0.25 * PLOT.height)
    expect(fromSvg(sx, sy)).toEqual([0.25, 0.75])
  })

  it('clamps positions outside the plot', () => {
    expect(fromSvg(-50, -50)).toEqual([0, 1])
  })
})

describe('snap', () => {
  it('snaps to the grid step when enabled', () => {
    expect(snap(0.13, 0.125)).toBe(0.125)
    expect(snap(0.13, 0)).toBe(0.13)
  })
})

describe('curvePoints', () => {
  it('includes both sides of a vertical jump so it draws as a vertical line', () => {
    const g: Graph = { color: 'c0c0c0', points: [{ x: 0, y: 0.2, mode: 'step_end' }, { x: 0.5, y: 0.8, mode: 'step_end' }] }
    const pts = curvePoints(g, 10)

    expect(pts).toContainEqual([0.5, 0.2])
    expect(pts).toContainEqual([0.5, 0.8])
    expect(pts[0]).toEqual([0, 0.2])
    expect(pts.at(-1)).toEqual([1, 0.8])
  })
})

describe('nearestPoint', () => {
  it('finds the point under the cursor within a radius in SVG units', () => {
    const g: Graph = { color: 'c0c0c0', points: [{ x: 0, y: 0, mode: 'linear' }, { x: 0.5, y: 1, mode: 'linear' }] }
    const [sx, sy] = toSvg(0.5, 1)

    expect(nearestPoint(g, sx + 3, sy - 3, 10)).toBe(1)
    expect(nearestPoint(g, sx + 30, sy, 10)).toBeNull()
  })
})

describe('exportFileName', () => {
  it('makes an ASCII file name MA can import', () => {
    expect(exportFileName('Rain Stair #2')).toBe('fh_Rain_Stair_2.xml')
    expect(exportFileName('彩虹')).toBe('fh_form.xml')
  })
})
