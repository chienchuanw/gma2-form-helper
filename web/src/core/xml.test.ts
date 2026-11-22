import { describe, expect, it } from 'vitest'
import builtinXml from './__fixtures__/fh_builtin_forms.xml?raw'
import { parseFormsXml } from './xml'

describe('parseFormsXml', () => {
  it('reads every Form with its name and graph count', () => {
    const forms = parseFormsXml(builtinXml)

    expect(forms).toHaveLength(23)
    expect(forms[7].name).toBe('Sin')
    expect(forms[7].graphs).toHaveLength(1)
    expect(forms.find((f) => f.name === 'Circle')?.graphs).toHaveLength(2)
    expect(forms.find((f) => f.name === 'Sound')?.graphs).toHaveLength(11)
  })

  it('reads points, treating missing x/y as 0', () => {
    const sin = parseFormsXml(builtinXml)[7]
    const pts = sin.graphs[0].points

    expect(pts).toHaveLength(8)
    expect(pts[0]).toEqual({ x: 0, y: 0.5, mode: 'spline' })
    expect(pts[6]).toEqual({ x: 0.75, y: 0, mode: 'spline' })
  })

  it('sorts points by x, keeping file order for equal x', () => {
    const xml = wrap(`
      <Form index="0" name="T" display_2d="false">
        <SubForm index="0" display_spec_index="0" graph_color="c0c0c0">
          <SubFormPoint index="0" x="0.5" mode="linear" />
          <SubFormPoint index="1" x="0.25" y="1" mode="step_end" />
          <SubFormPoint index="2" x="0.25" y="0.3" mode="linear" />
          <SubFormPoint index="3" mode="spline" />
        </SubForm>
      </Form>`)
    const pts = parseFormsXml(xml)[0].graphs[0].points

    expect(pts.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [0.25, 1],
      [0.25, 0.3],
      [0.5, 0],
    ])
  })

  it('reads graph name and color and the display_2d flag', () => {
    const circle = parseFormsXml(builtinXml).find((f) => f.name === 'Circle')!
    const flyout = parseFormsXml(builtinXml).find((f) => f.name === 'Flyout')!

    expect(circle.display2d).toBe(true)
    expect(circle.graphs[1].color).toBe('30c0c0')
    expect(flyout.graphs[0].name).toBe('dimmer')
    expect(circle.graphs[0].name).toBeUndefined()
  })

  it('tolerates a BOM and float noise', () => {
    const xml =
      '﻿' +
      wrap(`
      <Form index="0" name="T" display_2d="false">
        <SubForm index="0" display_spec_index="0" graph_color="c0c0c0">
          <SubFormPoint index="0" x="0.5" y="-8.7422777e-08" mode="linear" />
        </SubForm>
      </Form>`)
    const p = parseFormsXml(xml)[0].graphs[0].points[0]

    expect(p.y).toBeCloseTo(0, 6)
  })

  it('rejects unknown modes and non-MA documents', () => {
    const badMode = wrap(`
      <Form index="0" name="T" display_2d="false">
        <SubForm index="0" display_spec_index="0" graph_color="c0c0c0">
          <SubFormPoint index="0" mode="wobble" />
        </SubForm>
      </Form>`)

    expect(() => parseFormsXml(badMode)).toThrow(/wobble/)
    expect(() => parseFormsXml('<html></html>')).toThrow()
    expect(() => parseFormsXml('not xml')).toThrow()
  })
})

function wrap(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<MA xmlns="http://schemas.malighting.de/grandma2/xml/MA" major_vers="3" minor_vers="9" stream_vers="60">${body}</MA>`
}
