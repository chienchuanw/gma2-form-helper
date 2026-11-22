-- Unit tests for the pure half of Form Helper Import.
-- Run from the repo root:  lua plugin/tests/test_logic.lua

local M = assert(loadfile("plugin/form-helper-import/Form Helper Import.lua"))()

local fails, count = 0, 0
local function eq(a, b, msg)
    count = count + 1
    if a ~= b then
        fails = fails + 1
        print(string.format("FAIL: %s (expected %s, got %s)", msg, tostring(b), tostring(a)))
    end
end

-- xml_name: the name MA's Import needs (with .xml, or names with spaces fail)
eq(M.xml_name("fh_Wave"), "fh_Wave.xml", "adds .xml")
eq(M.xml_name("fh_Wave.xml"), "fh_Wave.xml", "keeps .xml")
eq(M.xml_name("  fh_Wave.XML "), "fh_Wave.XML", "trims, keeps an upper-case extension")
eq(M.xml_name("C:\\x\\importexport\\fh_a.xml"), "fh_a.xml", "drops a Windows path")
eq(M.xml_name("/media/usb/gma2/importexport/fh_a.xml"), "fh_a.xml", "drops a Unix path")
eq(M.xml_name(""), nil, "empty is rejected")
eq(M.xml_name('fh_"a'), nil, "a quote would break the command")

-- import_cmd: /nc because the plugin asks about overwriting itself
eq(M.import_cmd("fh_Wave.xml", 30), 'Import "fh_Wave.xml" At Form 30 /nc', "import command")

-- parse_slot
eq(M.parse_slot("12"), 12, "plain number")
eq(M.parse_slot(" 7 "), 7, "trimmed")
eq(M.parse_slot("0"), nil, "pool numbers start at 1")
eq(M.parse_slot("1.5"), nil, "no fractions")
eq(M.parse_slot("ab"), nil, "not a number")
eq(M.parse_slot(nil), nil, "cancelled input")

-- first_empty
local taken = { [1] = true, [2] = true, [3] = true, [5] = true }
eq(M.first_empty(function(n) return taken[n] end, 1, 100), 4, "first gap")
eq(M.first_empty(function(n) return taken[n] end, 5, 100), 6, "search from a start")
eq(M.first_empty(function() return true end, 1, 10), nil, "pool full")

-- parse_forms: what a file holds, for the confirmation
local xml = [[<?xml version="1.0" encoding="utf-8"?>
<MA xmlns="http://schemas.malighting.de/grandma2/xml/MA" major_vers="3" minor_vers="9" stream_vers="60">
	<Info datetime="2026-11-22T14:02:49" showfile="gma2-form-helper" />
	<Form index="0" name="Fly &amp; Out" display_2d="false">
		<SubForm index="0" name="dimmer" display_spec_index="0" graph_color="c0c0c0">
			<SubFormPoint index="0" x="0.2" mode="linear" />
		</SubForm>
		<SubForm index="1" display_spec_index="0" graph_color="30c0c0">
			<SubFormPoint index="0" mode="linear" />
		</SubForm>
	</Form>
	<Form index="1" name="Second" display_2d="false">
		<SubForm index="0" display_spec_index="0" graph_color="c0c0c0" />
	</Form>
</MA>]]
local forms = M.parse_forms(xml)
eq(#forms, 2, "two forms")
eq(forms[1].name, "Fly & Out", "entities decoded")
eq(forms[1].graphs, 2, "graph count")
eq(forms[2].graphs, 1, "self-closing SubForm counted")
eq(#M.parse_forms("<html></html>"), 0, "not an MA export")
eq(M.version(xml), "3.9.60", "header version")

-- newest: first fh_*.xml in a newest-first listing
eq(M.newest("fh_b.xml\r\nfh_a.xml\r\n"), "fh_b.xml", "Windows dir output")
eq(M.newest("/x/importexport/notes.txt\n/x/importexport/fh_c.xml\n"), "fh_c.xml", "ls output with paths")
eq(M.newest(""), nil, "nothing found")

-- list_cmd per OS
eq(M.list_cmd("C:/a b/importexport", "WINDOWS"), 'dir /b /o-d "C:\\a b\\importexport\\fh_*.xml" 2>nul', "Windows listing")
eq(M.list_cmd("/home/user/gma2/importexport", "LINUX"), 'ls -t "/home/user/gma2/importexport"/fh_*.xml 2>/dev/null', "console listing")

-- strip_number: getobj.name appends the pool number
eq(M.strip_number("Flyout 123", 123), "Flyout", "number removed")
eq(M.strip_number("Ramp 50 7", 7), "Ramp 50", "only the trailing pool number")

print(string.format("%d checks, %d failed", count, fails))
os.exit(fails == 0 and 0 or 1)
