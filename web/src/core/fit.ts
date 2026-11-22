import { evaluate } from './evaluate'
import { roundCoord, type Mode, type Point } from './model'

export interface FitOptions {
  /** Largest allowed distance between the stroke and the fitted curve (0–1 scale). */
  tolerance: number
  /** Snap the resulting points to this grid (0–1 steps), if given. */
  grid?: { x: number; y: number } | null
}

interface Sample {
  x: number
  y: number
}

/** Precision slider (1 = few points … 10 = close fit) to a tolerance on the 0–1 scale. */
export function precisionToTolerance(precision: number): number {
  const p = Math.min(10, Math.max(1, precision))
  return 0.08 * Math.pow(0.005 / 0.08, (p - 1) / 9)
}

/** Strokes narrower than this in x are not fitted. */
const MIN_SPAN = 0.01
/** Spacing of the resampled stroke. */
const STEP = 0.0025
/** A stroke part steeper than this over less than JUMP_DX is drawn as a vertical jump. */
const JUMP_DX = 0.01
const JUMP_DY = 0.08
/** Direction change (radians) at a point between two curves that counts as a sharp corner. */
const CORNER = (50 * Math.PI) / 180
const MAX_REFINE = 60

/**
 * Turn a freehand stroke (pointer samples, 0–1 coordinates) into Form points
 * with modes: as few points as the tolerance allows, linear where the stroke is
 * straight, spline where it curves, vertical jumps where it was drawn straight
 * up or down, and break pairs at sharp corners between curves.
 */
export function fitStroke(samples: readonly Sample[], opts: FitOptions): Point[] {
  const tol = Math.max(1e-4, opts.tolerance)
  const pieces = split(monotonic(samples))
  if (pieces.length === 0) return []

  // Key point indices into each piece's resampled stroke. RDP is a straight-line
  // simplifier, so seed coarsely and let the curve refinement add what it needs.
  const keys = pieces.map((p) => rdp(p, 0, p.length - 1, tol * 4))
  let points = build(pieces, keys, tol)
  for (let round = 0; round < MAX_REFINE; round++) {
    const worst = worstSample(pieces, keys, points, tol)
    if (!worst) break
    keys[worst.piece] = [...keys[worst.piece], worst.index].sort((a, b) => a - b)
    points = build(pieces, keys, tol)
  }
  return opts.grid ? snapPoints(points, opts.grid) : points
}

/** Drop backtracking so x never decreases; clamp into the unit square. */
function monotonic(samples: readonly Sample[]): Sample[] {
  const out: Sample[] = []
  for (const s of samples) {
    const p = { x: clamp01(s.x), y: clamp01(s.y) }
    if (out.length === 0 || p.x >= out[out.length - 1].x) out.push(p)
  }
  if (out.length < 2 || out[out.length - 1].x - out[0].x < MIN_SPAN) return []
  return out
}

/**
 * Split the stroke at vertical jumps and resample each piece evenly in x.
 * A jump is a run of samples that climbs or falls at least JUMP_DY within JUMP_DX.
 */
function split(s: Sample[]): Sample[][] {
  if (s.length === 0) return []
  // Each cut: the piece before ends at `end` (bottom of the climb, inclusive) and
  // the next starts at `start` (where the climb has reached its new level).
  const cuts: { end: number; start: number }[] = []
  let i = 0
  while (i < s.length - 1) {
    let j = i
    while (j + 1 < s.length && s[j + 1].x - s[i].x < JUMP_DX) j++
    const rise = s[j].y - s[i].y
    if (j > i && Math.abs(rise) >= JUMP_DY) {
      let start = i + 1
      while (start < j && Math.abs(s[j].y - s[start].y) > Math.abs(rise) * 0.1) start++
      cuts.push({ end: i, start })
      i = start
    } else {
      i++
    }
  }
  const raw: Sample[][] = []
  let from = 0
  for (const c of cuts) {
    raw.push(s.slice(from, c.end + 1))
    from = c.start
  }
  raw.push(s.slice(from))
  return raw.filter((p) => p.length >= 1).map(resample)
}

/** Evenly spaced samples (STEP apart, ends included) by linear interpolation. */
function resample(s: Sample[]): Sample[] {
  const x0 = s[0].x
  const x1 = s[s.length - 1].x
  if (x1 - x0 < STEP) return [s[0], { x: x1, y: s[s.length - 1].y }]
  const n = Math.max(2, Math.ceil((x1 - x0) / STEP))
  const out: Sample[] = []
  let j = 0
  for (let k = 0; k <= n; k++) {
    const x = x0 + ((x1 - x0) * k) / n
    while (j + 1 < s.length - 1 && s[j + 1].x < x) j++
    const a = s[j]
    const b = s[Math.min(j + 1, s.length - 1)]
    const f = b.x > a.x ? (x - a.x) / (b.x - a.x) : 1
    out.push({ x, y: a.y + (b.y - a.y) * Math.min(1, Math.max(0, f)) })
  }
  return out
}

/** Ramer–Douglas–Peucker on a resampled piece; returns sorted key indices. */
function rdp(s: Sample[], a: number, b: number, tol: number): number[] {
  const keep = new Set([a, b])
  const stack: [number, number][] = [[a, b]]
  while (stack.length) {
    const [i, j] = stack.pop()!
    const [k, d] = farthest(s, i, j)
    if (d > tol && k > i && k < j) {
      keep.add(k)
      stack.push([i, k], [k, j])
    }
  }
  return [...keep].sort((x, y) => x - y)
}

function farthest(s: Sample[], i: number, j: number): [number, number] {
  let best = i
  let dist = 0
  for (let k = i + 1; k < j; k++) {
    const d = Math.abs(s[k].y - lerpY(s[i], s[j], s[k].x))
    if (d > dist) {
      dist = d
      best = k
    }
  }
  return [best, dist]
}

const lerpY = (a: Sample, b: Sample, x: number) => (b.x > a.x ? a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) : b.y)

/** Direction change at sample k of a piece, from the stroke on both sides. */
function turn(s: Sample[], k: number): number {
  const h = Math.max(1, Math.round(0.02 / STEP))
  if (k - h < 0 || k + h >= s.length) return 0
  const before = Math.atan2(s[k].y - s[k - h].y, s[k].x - s[k - h].x)
  const after = Math.atan2(s[k + h].y - s[k].y, s[k + h].x - s[k].x)
  return Math.abs(after - before)
}

interface Seg {
  x: number
  y: number
  /** Linear or spline for the segment that starts here; refined below. */
  curved: boolean
  /** Sharp corner at this point (between two curves). */
  corner: boolean
  /** This point is the left side of a vertical jump. */
  jump: boolean
  /** Hold this value and jump at the next point (Step (End)). */
  step?: boolean
}

/** Points with modes from the key indices of every piece. */
function build(pieces: Sample[][], keys: number[][], tol: number): Point[] {
  const segs: Seg[] = []
  pieces.forEach((s, pi) => {
    const ks = keys[pi]
    ks.forEach((k, n) => {
      const next = ks[n + 1]
      const curved = next !== undefined && farthest(s, k, next)[1] > tol / 2
      const jump = next === undefined && pi < pieces.length - 1
      // The top of a jump sits at the jump's x, so both sides share it exactly.
      const x = jump ? pieces[pi + 1][0].x : s[k].x
      const prev = segs[segs.length - 1]
      if (prev && prev.x === roundCoord(x) && prev.y === roundCoord(s[k].y)) segs.pop() // same point twice
      segs.push({
        x: roundCoord(x),
        y: roundCoord(s[k].y),
        curved,
        corner: n > 0 && next !== undefined && turn(s, k) > CORNER,
        jump,
      })
    })
  })

  // The stroke's ends meet across the wrap: if it spans the whole cycle and ends
  // where it began, the last point is redundant and the wrap segment continues it.
  const first = segs[0]
  const last = segs[segs.length - 1]
  const fullCycle = first.x <= 0.01 && last.x >= 0.99
  const closes = fullCycle && segs.length > 2 && Math.abs(last.y - first.y) <= tol
  // The last point stays when the wrap jumps from it back to the start value.
  function fullCycleKeep(p: Seg) {
    return p !== last || !fullCycle || closes
  }
  if (closes) {
    segs.pop()
    segs[segs.length - 1].jump = false
    segs[segs.length - 1].curved = segs[segs.length - 1].curved || segs[0].curved
  } else {
    last.curved = false // across the undrawn part (or a jump at x = 100): straight
  }

  // A flat straight run into a jump (or into the wrap, where the value jumps back
  // to the start) is one Step (End) point: drop the point at the top of the jump.
  for (let i = segs.length - 2; i >= 0; i--) {
    const a = segs[i]
    const b = segs[i + 1]
    const intoJump = b.jump || (i + 1 === segs.length - 1 && !fullCycleKeep(b))
    if (intoJump && !a.curved && !a.jump && Math.abs(a.y - b.y) <= tol / 2) {
      a.step = true
      segs.splice(i + 1, 1)
    }
  }

  const n = segs.length
  const curvedAt = (i: number) => segs[((i % n) + n) % n].curved && !segs[((i % n) + n) % n].jump
  const cornerAt = (i: number) => segs[((i % n) + n) % n].corner
  return segs.map((seg, i): Point => ({ x: seg.x, y: seg.y, mode: modeOf(i) }))

  function modeOf(i: number): Mode {
    const seg = segs[i]
    if (seg.step) return 'step_end'
    if (seg.jump || !curvedAt(i)) return 'linear'
    // Chain boundaries at sharp corners become a break pair; a chain of one
    // segment between two corners cannot curve (its ends would be parabolic).
    const startsAtCorner = cornerAt(i) && curvedAt(i - 1)
    const endsAtCorner = cornerAt(i + 1) && curvedAt(i + 1)
    if (startsAtCorner && endsAtCorner) return 'linear'
    if (startsAtCorner) return 'spline_break_start'
    if (endsAtCorner) return 'spline_break_end'
    return 'spline'
  }
}

/** The stroke sample farthest from the fitted curve, if it is beyond tolerance. */
function worstSample(pieces: Sample[][], keys: number[][], points: Point[], tol: number) {
  const graph = { color: '', points }
  let worst: { piece: number; index: number; d: number } | null = null
  pieces.forEach((s, pi) => {
    const have = new Set(keys[pi])
    s.forEach((p, k) => {
      if (have.has(k) || k === 0 || k === s.length - 1) return
      const d = Math.abs(evaluate(graph, p.x) - p.y)
      if (d > tol && (!worst || d > worst.d)) worst = { piece: pi, index: k, d }
    })
  })
  return worst as { piece: number; index: number; d: number } | null
}

/**
 * Snap to the grid. Points that land on the same grid line as the previous one
 * are dropped (they would become an accidental vertical jump), except the two
 * sides of a jump that was actually drawn, which already shared their x.
 */
function snapPoints(points: Point[], grid: { x: number; y: number }): Point[] {
  const out: Point[] = []
  let prevX: number | null = null
  for (const p of points) {
    const q = { ...p, x: roundCoord(Math.round(p.x / grid.x) * grid.x), y: roundCoord(Math.round(p.y / grid.y) * grid.y) }
    const prev = out[out.length - 1]
    const drawnJump = prevX !== null && p.x === prevX
    if (prev && prev.x === q.x && (!drawnJump || prev.y === q.y)) continue
    out.push(q)
    prevX = p.x
  }
  return out
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}
