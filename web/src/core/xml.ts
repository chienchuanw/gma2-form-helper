import { MODES, type Form, type Graph, type Mode, type Point } from './model'

export class FormXmlError extends Error {}

/** Parse a grandMA2 export file (one or more <Form> elements). */
export function parseFormsXml(text: string): Form[] {
  const doc = new DOMParser().parseFromString(text.replace(/^﻿/, ''), 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new FormXmlError('Not a valid XML file')
  }
  if (doc.documentElement.localName !== 'MA') {
    throw new FormXmlError('Not a grandMA2 export file (root element is not <MA>)')
  }
  return children(doc.documentElement, 'Form').map(parseForm)
}

function parseForm(el: Element): Form {
  return {
    name: el.getAttribute('name') ?? '',
    display2d: el.getAttribute('display_2d') === 'true',
    graphs: children(el, 'SubForm').map(parseGraph),
  }
}

function parseGraph(el: Element): Graph {
  const graph: Graph = {
    color: el.getAttribute('graph_color') ?? 'c0c0c0',
    points: sortPoints(children(el, 'SubFormPoint').map(parsePoint)),
  }
  const name = el.getAttribute('name')
  if (name !== null) graph.name = name
  return graph
}

function parsePoint(el: Element): Point {
  return {
    x: num(el, 'x'),
    y: num(el, 'y'),
    mode: parseMode(el.getAttribute('mode')),
  }
}

function parseMode(value: string | null): Mode {
  if (value === null) return 'linear'
  if ((MODES as readonly string[]).includes(value)) return value as Mode
  throw new FormXmlError(`Unknown point mode "${value}"`)
}

/** MA omits x/y when they are 0. */
function num(el: Element, attr: string): number {
  const raw = el.getAttribute(attr)
  if (raw === null) return 0
  const n = Number(raw)
  if (!Number.isFinite(n)) throw new FormXmlError(`Invalid ${attr}="${raw}"`)
  return n
}

/** Stable sort by x: points sharing an x keep their file order (MA's creation order). */
export function sortPoints(points: Point[]): Point[] {
  return points
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.x - b.p.x || a.i - b.i)
    .map(({ p }) => p)
}

function children(el: Element, name: string): Element[] {
  return Array.from(el.children).filter((c) => c.localName === name)
}

export interface MaVersion {
  major: number
  minor: number
  stream: number
}

export const DEFAULT_VERSION: MaVersion = { major: 3, minor: 9, stream: 60 }

export interface SerializeOptions {
  version?: MaVersion
  /** Timestamp written to <Info datetime>; defaults to now. */
  date?: Date
}

/** Write Forms as a grandMA2 export file that `Import "file" At Form N` accepts. */
export function serializeFormsXml(forms: Form[], opts: SerializeOptions = {}): string {
  const v = opts.version ?? DEFAULT_VERSION
  const vs = `${v.major}.${v.minor}.${v.stream}`
  const date = (opts.date ?? new Date()).toISOString().slice(0, 19)
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<MA xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://schemas.malighting.de/grandma2/xml/MA" xsi:schemaLocation="http://schemas.malighting.de/grandma2/xml/MA http://schemas.malighting.de/grandma2/xml/${vs}/MA.xsd" major_vers="${v.major}" minor_vers="${v.minor}" stream_vers="${v.stream}">`,
    `\t<Info datetime="${date}" showfile="gma2-form-helper" />`,
  ]
  forms.forEach((form, fi) => {
    lines.push(`\t<Form index="${fi}" name="${esc(form.name)}" display_2d="${form.display2d}">`)
    form.graphs.forEach((g, gi) => {
      const name = g.name === undefined ? '' : ` name="${esc(g.name)}"`
      lines.push(`\t\t<SubForm index="${gi}"${name} display_spec_index="0" graph_color="${esc(g.color)}">`)
      g.points.forEach((p, pi) => {
        const x = p.x === 0 ? '' : ` x="${p.x}"`
        const y = p.y === 0 ? '' : ` y="${p.y}"`
        lines.push(`\t\t\t<SubFormPoint index="${pi}"${x}${y} mode="${p.mode}" />`)
      })
      lines.push('\t\t</SubForm>')
    })
    lines.push('\t</Form>')
  })
  lines.push('</MA>', '')
  return lines.join('\r\n')
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
