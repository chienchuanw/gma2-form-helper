# Form Helper Import (grandMA2 plugin)

Imports a Form made with the Form Helper web page into the grandMA2 Form pool,
without typing the `Import` command. Tested on grandMA2 onPC 3.9.60.

## Install

1. Download `form-helper-import.zip` from the releases page, or take the two
   files in [`form-helper-import/`](form-helper-import/).
2. Copy **both** files (`Form Helper Import.xml` and `Form Helper Import.lua`)
   into the `plugins` folder:
   - onPC: `C:\ProgramData\MA Lighting Technologies\grandma\gma2_V_3.9.60\plugins`
   - console via USB stick: `gma2/plugins` on the stick
3. In MA: open the Plugins pool, `Edit` an empty cell, tap **Import**, and pick
   `Form Helper Import.xml`. Or type: `Import "Form Helper Import.xml" At Plugin 1`
   (with the USB drive selected when importing from a stick).

## Use

1. Export your Form from the web page (`fh_<name>.xml`) and copy it into
   `importexport`:
   - onPC: `...\gma2_V_3.9.60\importexport`
   - USB stick: `gma2/importexport`
2. Run the plugin. It asks three things:
   - **Drive**: `1` for the internal drive. For a USB stick, type its number
     from the `SelectDrive` list (type `SelectDrive` in the command line to see it).
   - **Form file**: on the internal drive the newest `fh_*.xml` is filled in.
   - **Import into Form**: the first empty Form slot is filled in.
3. It shows what the file holds and which existing Forms would be
   **replaced** (a file with several Forms fills consecutive slots). Nothing is
   overwritten unless you confirm.
4. It imports and checks that the slot really changed; the result is in the
   System Monitor and the command line feedback, and a failure is shown in a
   dialog.

On a USB stick the plugin cannot read the file beforehand, so there is no
preview. It then imports without `/nc`, and MA shows its own Overwrite
Confirmation if any existing Form would be replaced. The USB drive stays
selected afterwards.

## Develop

Pure logic sits at the top of the `.lua` file and is exported when `gma` is nil,
so it runs without a console:

```sh
lua plugin/tests/test_logic.lua
```

The file must stay Lua 5.1 compatible (no `goto`, no `//`, no `table.unpack`).
To package a release zip:

```sh
./scripts/build-plugin.sh   # -> dist/form-helper-import.zip
```

### Notes from the console

- `Import` needs the `.xml` extension when the file name contains a space.
- Importing into an occupied slot opens MA's Overwrite Confirmation on screen
  (also from a plugin, which waits for the answer); `/nc` replaces silently.
  With a readable file the plugin asks about every slot first and uses `/nc`;
  otherwise it leaves the question to MA.
- A file with several Forms fills consecutive slots from the target on.
- `getvar("OS")` is `WINDOWS` on onPC.
- `gma.show.getobj.handle("Form N")` is nil for an empty slot.
