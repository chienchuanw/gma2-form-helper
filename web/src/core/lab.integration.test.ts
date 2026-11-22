/**
 * Imports XML written by serializeFormsXml into a real grandMA2 onPC and reads the
 * points back over telnet. Runs only when MA2_HOST is set (see tools/ma2lab.py);
 * the tool refuses to write unless the lab show is loaded.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Form } from './model'
import { MODE_LABELS } from './table'
import { serializeFormsXml } from './xml'

const LAB_SLOT = 120
const tool = resolve(import.meta.dirname, '../../../tools/ma2lab.py')

describe.runIf(process.env.MA2_HOST)('onPC lab round trip', () => {
  it('imports a generated multi-graph Form with every mode exactly', () => {
    const form: Form = {
      name: 'FH Integration',
      display2d: false,
      graphs: [
        {
          name: 'all modes',
          color: 'ff0000',
          points: [
            { x: 0, y: 0.25, mode: 'linear' },
            { x: 0.125, y: 0.9, mode: 'spline' },
            { x: 0.333, y: 0.1, mode: 'spline_break_start' },
            { x: 0.5, y: 0.75, mode: 'spline_break_end' },
            { x: 0.5, y: 0.2, mode: 'step_start' },
            { x: 0.875, y: 1, mode: 'step_end' },
          ],
        },
        { color: '00c000', points: [{ x: 0.2, y: 1, mode: 'linear' }] },
      ],
    }
    const dir = mkdtempSync(join(tmpdir(), 'fh-'))
    const file = join(dir, 'fh_integration.xml')
    writeFileSync(file, serializeFormsXml([form]))

    const out = execFileSync('python3', [tool, 'import', file, String(LAB_SLOT), '--json'], {
      encoding: 'utf8',
      timeout: 120_000,
    })

    // MA lists 0–100 with two decimals; compare numerically, not as strings.
    const listed: Record<string, [number, number, string][]> = JSON.parse(out)
    expect(Object.keys(listed)).toHaveLength(form.graphs.length)
    form.graphs.forEach((g, i) => {
      const rows = listed[String(i + 1)]
      expect(rows.map((r) => r[2])).toEqual(g.points.map((p) => MODE_LABELS[p.mode]))
      rows.forEach(([x, y], k) => {
        expect(Math.abs(x - g.points[k].x * 100)).toBeLessThanOrEqual(0.005)
        expect(Math.abs(y - g.points[k].y * 100)).toBeLessThanOrEqual(0.005)
      })
    })
  }, 180_000)
})
