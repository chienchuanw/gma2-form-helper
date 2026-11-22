# How grandMA2 draws Form curves

Calibrated on grandMA2 onPC 3.9.60.50 (2026-11-22) against the Graph Editor.
Implemented in `web/src/core/evaluate.ts`; reference curves are in
`web/src/core/__fixtures__/ma_curves.json` and checked by
`web/src/core/evaluate.calibration.test.ts`.

## Rules

Points are sorted by x. Each point's **mode governs the segment from that point
to the next one**. The last point connects back to the first across x = 100 (the
curve is periodic).

| Mode | Segment from P(k) to P(k+1) |
|------|-----------------------------|
| Linear | straight line |
| Step (End) | holds P(k).y, jumps to P(k+1).y at the end |
| Step (Start) | jumps to P(k+1).y right at the start, holds it |
| Spline | part of a spline chain (below) |
| Spline (Break at Start) | starts a new spline chain at P(k) |
| Spline (Break at End) | ends the current spline chain at P(k+1) |

**Spline chains.** Consecutive spline-mode segments form one chain, solved as a
single C2 cubic spline in x (continuous slope and curvature through every
interior point). Moving one point therefore changes the whole chain, with
ripples that decay away from it.

How a chain ends:

- **Its own break** (its first segment is Break at Start, or its last segment is
  Break at End): a *parabolic* end, `m0 + m1 = 2 * secant` of that end segment.
  The curve meets the neighbouring segment with a visible corner. Built-in Bump
  and Swing use a Break at Start on their first point and a Break at End on their
  last spline point.
- **Next to a Linear segment**: the chain takes that segment's slope, so the
  curve joins the line smoothly (it can overshoot the point to do so).
- **Next to a broken chain** (the next segment is Break at Start, or the previous
  one is Break at End): the chain takes the secant of that neighbouring segment,
  joining the broken chain smoothly from outside while the broken chain itself
  keeps its corner. Measured for the Break at Start side (Form 101); the Break at
  End side is assumed symmetric.
- **Next to a Step segment**: slope 0 (steps are flat). Measured for both Step
  (Start) and Step (End).
- **No ends at all** (every segment is spline and there are no breaks): one
  closed, periodic spline.

Taking a neighbour's slope means a chain next to a *near-vertical* segment (say
a Linear segment 0.3 wide) is clamped to a huge slope and shoots far off the
chart. MA does exactly the same (captured), so the tool reproduces it and
`analyzeGraph()` warns `overshoot`.

## Accuracy

Error of `evaluate()` against the reference curves in `ma_curves.json` (values on
the 0–100 scale, sampled every 2 units). Pixel extraction is good to about ±0.5,
more on steep slopes where one pixel in x is ~0.1 unit.

| Case | RMS | Max |
|------|-----|-----|
| Spline chain between Linear segments | 0.24 | 0.62 |
| Spline chains next to Step (End) | 0.20 | 0.54 |
| Spline chain next to Step (Start) | 0.20 | 0.54 |
| Breaks in the middle, Linear and Step neighbours (Form 101) | 0.34 | 1.12 |
| Bump (paired breaks) | 0.29 | 0.89 |
| Swing (paired breaks, then Linear) | 0.21 | 0.66 |
| Closed spline, 2 points | 0.22 | 0.49 |
| Closed spline, 8 even points with one raised | 0.54 | 1.21 |
| Closed spline, 5 points | 1.14 | 2.47 |
| Closed spline, uneven spacing with one raised | 1.81 | 5.71 |
| Closed spline, uneven spacing | 2.71 | 5.44 |

In every measured case with chain ends (Linear, Step or break neighbours) the
model matches within extraction accuracy. For closed all-spline graphs MA's
curve is close to, but not exactly, a periodic C2 cubic, and the gap grows with
uneven spacing; `analyzeGraph()` reports those graphs as `approximate`.

Gaps in the reference data: samples on vertical strokes (step jumps) are
excluded, Swing's flat tail lies on the x axis and could not be separated from
it, and part of the wrap region of the 8-point case was hidden by the crosshair.

Models tried for the closed case and rejected (all worse): local Catmull-Rom
(central difference), average-of-secants, Bessel tangents, uniform and
centripetal/chordal parametric splines (2D), C2 splines over uniform or
sqrt-spaced knots, open natural/clamped splines over the cycle with and without
padding, and partially converged Jacobi/Gauss-Seidel solves.

## Cases MA does not draw sensibly

- **A spline segment of zero width** (two points at the same x inside a spline
  chain, including a 2-point graph from x = 0 to x = 100): MA draws **nothing**
  for the whole graph. `analyzeGraph()` warns `splineJump`; the tool draws the
  jump as a vertical step.
- **Unpaired breaks** in an all-spline graph (a Break at Start without a later
  Break at End, or the reverse): MA draws segments that shoot far off the chart.
  `analyzeGraph()` warns `unpairedBreak`; the tool draws its own chain model
  instead. Unpaired breaks in graphs that also contain Linear or Step segments
  were not measured.

## Method

1. Calibration Forms were generated as XML and imported into lab slots with
   `tools/ma2lab.py import` (only in the `form-helper-lab` show).
2. The Graph Editor cannot be opened over telnet: `Edit Form N` opens it in the
   telnet session's own context, not on screen. It was opened by injecting input
   into the onPC window: a scheduled task (`schtasks /it`) running in the
   logged-in desktop session presses `E` (Edit) and taps the Form's pool cell,
   then a second scheduled task captures the screen. Built-in Forms are locked
   and cannot be opened this way, so unlocked copies were imported.
3. The graph area was cropped; the curve pixels (light grey) were extracted per
   pixel column and mapped to 0–100 using the red point markers. On a 2560×1600
   screen one unit of y is about 6 px.
4. Candidate models were fitted against the extracted curves; tangents were also
   solved freely by least squares to see which rule they follow.
