# Effect preview (試跑) design

Date: 2026-11-27 · Issue #23 · Follow-ups: #24 (Art-Net capture tool), #25 (onPC calibration), #26 (second batch)

## Goal

Play the Form being drawn as a dimmer effect on a row of fixtures, with phase spread across them, so a lighting designer can judge the wave and the hits on the beat before taking the Form to the console. The v1 spec deferred this (`2026-11-22-form-helper-design.md`, "模擬 Effect 套到一排燈上的效果，留到第二版").

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Scope | A row of fixtures with phase spread (not a single fixture, not the full MA effect model) | A single fixture adds little over a playhead; Width/Blocks/Groups/Wings need calibration first (#26) |
| Source graph | The active graph tab | Edit and watch the same graph; no extra control |
| Colour | Warm white, not the graph colour | `graph_color` is only the editor's line colour in MA |
| Placement | Always-visible panel under the canvas, expanded, paused on load | Editing while playing is the point; the side column is too narrow |
| Fixtures | Default 8 (half a beat apart at 0 → −360, matching the & grid), range 1–32, −/+ and a number field | 32 is a long truss row and still about 20 px each |
| Speed | Music tempo in BPM, default 120; one cycle = one bar = 4 beats | Matches the beat guides; the hint shows the MA Effect Speed to enter (BPM ÷ 4) |
| Phase | Start/end in degrees, default 0 → −360 (MA's default); quick buttons 0 → −360, 0 → 360, 0; range ±2880 like MA | |
| Low / High | 0–100, default 0 / 100; Low > High allowed (inverts) | MA allows it |
| Brightness | Linear in sRGB from the output level; glow at high levels; dim outline at 0 | Shows the value MA sends; real dimmer curves differ per fixture |
| Transport | Play/pause (button and Space), back to start, pause freezes the frame; edits and BPM changes never interrupt playback | |
| Canvas | Playhead at fixture 1 plus one dot per fixture on the curve | Shows how the phase spreads along the Form |
| State | Not in undo/redo, not persisted | Viewing settings, like snap and precision |
| Motion | Never autoplays; manual play always works | Covers `prefers-reduced-motion` |
| Accessibility | Fixture strip, playhead and dots are `aria-hidden` (like the beat guides); controls are labelled | |

## Unverified rules (all in `web/src/core/effect.ts`)

MA's documentation does not settle these; #25 measures them on onPC 3.9.60 with the Art-Net capture tool (#24). The UI and README say they are unverified until then.

1. **Spread**: fixture *i* of *n* gets `start + (end − start) · i / n`, so 8 fixtures at 0 → −360 end at −315 and the wave repeats evenly.
2. **Sign**: a fixture with phase φ shows the Form at `pos + φ / 360`, so a negative phase lags and 0 → −360 travels from fixture 1 towards fixture *n*. Sources: dot2 effect docs (presets 0..360 and 0..−360 differ in direction) and a dot2 guide stating 0 to −360 is needed "to look like it moves from left to right".
3. **Speed**: MA's Effect Speed in BPM is Form cycles per minute (grandMA2 docs: "Rate 1 corresponds to 60.0 BPM"), so a Form drawn as one bar needs Effect Speed = tempo ÷ 4; one bar lasts `240 / BPM` seconds.

Low/High is documented ("the lowest/highest point an effect reaches") and treated as settled: level = Low + (High − Low) · value, clamped to 0–100.

## Architecture

- `core/effect.ts` (pure): `phaseFor`, `cycleSeconds`, `maEffectSpeed`, `levelAt`, `fixtureFrame` (every fixture's phase, position on the Form, raw value and output level at a bar position).
- `editor/usePlayback.ts`: play/pause/reset and a `requestAnimationFrame` loop that advances the bar position by `dt / cycleSeconds(bpm)`; listeners are called per frame. Integrating per frame keeps the position when BPM changes.
- `editor/EffectPreview.tsx`: controls and the fixture strip. Per-frame updates write to DOM refs (CSS `--level`, `title`), so React renders only structure.
- `GraphCanvas.tsx`: an `aria-hidden` overlay group with the playhead and dots, updated the same way.
- `App.tsx`: owns the preview parameters and the playback hook, and adds Space to the keyboard handler.

## Out of scope

Width, Blocks, Groups, Wings, tap tempo, a position slider (#26); onPC verification (#25); other attributes, dimmer curves, 2D layouts; persistence.
