#!/usr/bin/env bash
# Package the grandMA2 plugin into dist/form-helper-import.zip (file names kept,
# so the .xml's luafile= still matches the .lua on import).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT/dist"
rm -f "$ROOT/dist/form-helper-import.zip"
lua "$ROOT/plugin/tests/test_logic.lua" >/dev/null
(cd "$ROOT/plugin/form-helper-import" && zip -q "$ROOT/dist/form-helper-import.zip" "Form Helper Import.xml" "Form Helper Import.lua")
echo "built: dist/form-helper-import.zip"
