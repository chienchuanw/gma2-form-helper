import { describe, expect, it } from 'vitest'
import builtinXml from './__fixtures__/fh_builtin_forms.xml?raw'
import { roundCoord } from './model'
import { MODE_LABELS, tableRows, tableText } from './table'
import { parseFormsXml } from './xml'

const forms = parseFormsXml(builtinXml)

describe('tableRows', () => {
  it('formats points the way MA Table Mode shows them', () => {
    const sin = forms.find((f) => f.name === 'Sin')!.graphs[0]

    // Values copied from `List` on onPC 3.9.60 (cd Form 8 / cd 1 / List).
    expect(tableRows(sin)).toEqual([
      { no: 1, x: '0.00', y: '50.00', mode: 'Spline' },
      { no: 2, x: '12.50', y: '85.36', mode: 'Spline' },
      { no: 3, x: '25.00', y: '100.00', mode: 'Spline' },
      { no: 4, x: '37.50', y: '85.36', mode: 'Spline' },
      { no: 5, x: '50.00', y: '50.00', mode: 'Spline' },
      { no: 6, x: '62.50', y: '14.64', mode: 'Spline' },
      { no: 7, x: '75.00', y: '0.00', mode: 'Spline' },
      { no: 8, x: '87.50', y: '14.64', mode: 'Spline' },
    ])
  })

  it('never shows negative zero for float noise', () => {
    const swing = forms.find((f) => f.name === 'Swing')!.graphs[0]

    expect(tableRows(swing).at(-1)?.y).toBe('0.00')
  })
})

describe('MODE_LABELS', () => {
  it('uses the exact names from the MA Mode column', () => {
    expect(MODE_LABELS).toEqual({
      linear: 'Linear',
      spline: 'Spline',
      spline_break_start: 'Spline (Break at Start)',
      spline_break_end: 'Spline (Break at End)',
      step_start: 'Step (Start)',
      step_end: 'Step (End)',
    })
  })
})

describe('roundCoord', () => {
  it('rounds a 0–1 value to one decimal on the 0–100 scale and clamps it', () => {
    expect(roundCoord(0.12345)).toBe(0.123)
    expect(roundCoord(0.12351)).toBe(0.124)
    expect(roundCoord(-0.2)).toBe(0)
    expect(roundCoord(1.7)).toBe(1)
  })
})

describe('tableText', () => {
  it('renders one tab-separated block per graph for copying', () => {
    const flyout = forms.find((f) => f.name === 'Flyout')!

    expect(tableText(flyout)).toBe(
      [
        '[1] dimmer',
        'No.\tX\tY\tMode',
        '1\t19.95\t0.00\tLinear',
        '2\t29.95\t100.00\tLinear',
        '3\t95.05\t100.00\tLinear',
        '4\t100.00\t0.00\tLinear',
        '',
        '[2] Position',
        'No.\tX\tY\tMode',
        '1\t0.00\t0.00\tLinear',
        '2\t100.00\t100.00\tLinear',
      ].join('\n'),
    )
  })
})
