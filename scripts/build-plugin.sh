#!/usr/bin/env bash
# Package the grandMA2 plugin into dist/form-helper-import.zip (file names kept,
# so the .xml's luafile= still matches the .lua on import). Runs the plugin's
# logic tests first and stops if they fail.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
lua plugin/tests/test_logic.lua
mkdir -p dist
rm -f dist/form-helper-import.zip
(cd plugin/form-helper-import && zip -q "$ROOT/dist/form-helper-import.zip" "Form Helper Import.xml" "Form Helper Import.lua")
echo "built: dist/form-helper-import.zip"
