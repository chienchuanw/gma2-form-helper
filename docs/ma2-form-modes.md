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

- **Next to a Linear segment**: the chain takes that segment's slope, so the
  curve joins the line smoothly (it can overshoot the point to do so).
- **Next to a Step segment**: slope 0 (steps are flat).
- **At a break**: natural end (zero curvature). The curve meets the following
  segment with a visible corner. Built-in Bump and Swing use a Break at Start on
  their first point and a Break at End on their last spline point.
- **No ends at all** (every segment is spline and there are no breaks): one
  closed, periodic spline.

## Accuracy

Error of `evaluate()` against curves pixel-extracted from the Graph Editor, on
the 0–100 scale. Pixel extraction itself is good to about ±1.

| Case | RMS | Max |
|------|-----|-----|
| Spline chain between Linear segments | 0.3 | 1.1 |
| Spline chains next to Step (End) | 0.2 | 0.8 |
| Bump (paired breaks) | 0.3 | 1.2 |
| Swing (paired breaks, then Linear) | 0.3 | 1.0 |
| Closed spline, 2 points | 0.2 | 0.7 |
| Closed spline, 8 even points with one raised | 0.6 | 1.3 |
| Closed spline, 5 points | 1.2 | 2.8 |
| Closed spline, uneven spacing | 2.7 | 5.6 |
| Closed spline, uneven spacing with one raised | 2.0 | 6.0 |

Everything except the **closed all-spline** case matches within pixel accuracy.
For closed splines MA's curve is close to, but not exactly, a periodic C2 cubic.
The gap grows with uneven point spacing. `analyzeGraph()` reports such graphs as
`approximate` so the UI can say so.

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
  `analyzeGraph()` warns `unpairedBreak`; the tool draws a natural spline
  instead.

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
