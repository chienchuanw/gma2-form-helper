# grandMA2 Form Helper

Draw a grandMA2 effect **Form** in the browser and get exactly what to enter in
MA's Graph Editor: the X, Y and Mode of every point, or a file MA imports
directly. The preview follows the curve rules measured on grandMA2 itself, so
it matches what MA draws (closely approximated for closed all-Spline curves,
see below).

> 在瀏覽器裡畫出 grandMA2 的 Effect Form，直接得到 Graph Editor Table Mode
> 每個點要填的 X、Y、Mode，或匯出 MA 可直接匯入的 XML。預覽依照在 grandMA2
> 實測校正的曲線規則繪製，看到的就是 MA 會畫出的樣子。介面支援繁體中文。

**Web app:** https://gma2-form-helper.vercel.app

## Features

- **Edit points**: click to add, drag to move, pick each segment's Mode
  (Linear, Spline, Spline (Break at Start/End), Step (Start/End)), with an
  optional snap grid (X every 12.5, Y every 10), undo/redo and keyboard nudging.
- **Draw**: sketch a stroke and it becomes a few clean points with automatically
  chosen modes. Straight runs become Linear, curves become Spline, and a flat run
  ending in a jump becomes a single Step (End) point. A Precision slider trades
  point count against closeness and re-fits the last stroke in place.
- **Several graphs per Form**, one tab each like MA's Table Mode, with names and
  colours; the other graphs show faintly behind the active one.
- **Table Mode values** formatted exactly as MA shows them (0–100, two decimals),
  with a Copy button.
- **Import / export MA XML**: open any Form export from MA (pick one Form when a
  file holds several) and export `fh_<name>.xml` for MA to import (target
  version grandMA2 3.9.60).
- **Honest preview**: closed all-Spline curves, which the model only
  approximates, are marked, and graphs MA cannot draw properly are flagged:
  two Spline points on one X, unpaired Breaks in an all-Spline graph, and
  Splines next to near-vertical segments.
- English and Traditional Chinese.

## Getting a Form into grandMA2

Pick whichever suits the console:

1. **Type it in.** In MA, `Edit` the Form, switch the Graph Editor to *Table
   Mode*, and enter the rows from the Points table (one tab per graph).
2. **Import the XML.** Export from the web app, copy `fh_<name>.xml` into
   `importexport` (onPC: `C:\ProgramData\MA Lighting Technologies\grandma\gma2_V_3.9.60\importexport`;
   USB stick: `gma2/importexport`). From a USB stick, first select its drive:
   type `SelectDrive` to list the drives, then `SelectDrive <number>`. Then:
   `Import "fh_<name>.xml" At Form <number>`.
   If the slot is taken MA asks before replacing it; `Import "fh_<name>.xml" At Form <number> /nc`
   replaces without asking.
3. **Use the plugin.** [Form Helper Import](plugin/README.md) asks for the
   drive, file and slot, imports, and checks the result. On the internal drive
   it also suggests the newest file and shows what will be replaced; on a USB
   stick it cannot read the file first, so MA's own overwrite question protects
   existing Forms. Download `form-helper-import.zip` from the
   [releases](https://github.com/chienchuanw/gma2-form-helper/releases).

Tested with grandMA2 onPC 3.9.60; importing from a USB stick on a real
console has not been tested yet.

## How MA draws Forms

The rules behind the preview, the measurements and their accuracy are in
[docs/ma2-form-modes.md](docs/ma2-form-modes.md). In short: Linear and Step are
exact; consecutive Spline segments form one smooth chain that blends into
neighbouring Linear segments, and Break at Start / Break at End are used as a
pair to bound a chain.

## Development

```text
web/      React + TypeScript + Vite app (core engine in web/src/core)
plugin/   grandMA2 Lua plugin + logic tests
tools/    ma2lab.py: drive an onPC test machine over telnet/ssh
docs/     design, calibration findings
```

Web app:

```sh
cd web
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run typecheck && npm run lint && npm run build
```

The onPC integration test imports generated XML into a real grandMA2 and reads
it back. It needs `python3`, key-based ssh/scp to the Windows machine, and
Telnet enabled in onPC (Setup > Console > Global Settings). It only runs when
asked to, refuses to touch any show except the lab show (`form-helper-lab`), and
replaces Form 120 there:

```sh
MA2_LAB=1 MA2_HOST=<ip> npm test   # see tools/ma2lab.py for the other settings
```

Plugin:

```sh
lua plugin/tests/test_logic.lua
./scripts/build-plugin.sh          # -> dist/form-helper-import.zip
```

Deploy: the Vercel project `gma2-form-helper` (Take Two Studio team) is
connected to this repository with Root Directory `web`. Pushing to `main`
deploys production; other branches get preview deployments. A manual deploy
runs from the repo root:

```sh
vercel link --scope take-two-studio --project gma2-form-helper   # once per clone
vercel deploy --prod --scope take-two-studio
```

## Release checklist

- [ ] `npm test`, typecheck, lint and build pass in `web/`
- [ ] `lua plugin/tests/test_logic.lua` passes
- [ ] Plugin tested on a real console from a USB stick (drive number, file in
      `gma2/importexport`, MA's own overwrite question) — cannot be simulated on onPC
- [ ] Plugin zip attached to the GitHub release

