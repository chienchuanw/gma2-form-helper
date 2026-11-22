-- Form Helper Import
-- Imports a Form XML made by the gma2-form-helper web tool into the Form pool:
-- pick the file, pick the slot (the first empty one by default), confirm before
-- replacing an existing Form, import, and check that it arrived.
--
-- Target version: grandMA2 3.9.60. Keep this file Lua 5.1 compatible: no goto,
-- no integer division, no table.unpack.
--
-- What the console taught us (onPC 3.9.60):
--   * Import needs the ".xml" extension when the file name has a space.
--   * Import into an occupied slot opens an Overwrite Confirmation, which a
--     plugin cannot answer; "/nc" replaces silently. So this plugin asks first
--     and then imports with /nc.
--   * gma.show.getobj.handle("Form N") is nil for an empty slot.
--   * gma.show.getvar("PATH") is the data folder; files live in its importexport.
--
-- Pure logic lives at the top and is exported when the global gma is nil:
--   lua plugin/tests/test_logic.lua

local PLUGIN_TITLE = "Form Helper Import"
local MAX_FORM = 9999

local M = {}

-- ─── pure logic ───────────────────────────────────────────────

local function trim(s)
    return (string.gsub(s, "^%s*(.-)%s*$", "%1"))
end

-- The file name Import needs: no folders, always with an .xml extension.
function M.xml_name(input)
    if type(input) ~= "string" then return nil end
    local name = trim(input)
    name = string.match(name, "([^/\\]+)$") or ""
    if name == "" or string.find(name, '"', 1, true) then return nil end
    if not string.find(string.lower(name), "%.xml$") then name = name .. ".xml" end
    return name
end

-- /nc: the plugin has already asked about overwriting, and MA's own dialog
-- cannot be answered from a plugin.
function M.import_cmd(file, slot)
    return string.format('Import "%s" At Form %d /nc', file, slot)
end

function M.parse_slot(input)
    if type(input) ~= "string" then return nil end
    local s = trim(input)
    if not string.find(s, "^%d+$") then return nil end
    local n = tonumber(s)
    if n < 1 or n > MAX_FORM then return nil end
    return n
end

function M.first_empty(is_taken, start, limit)
    for n = start, limit do
        if not is_taken(n) then return n end
    end
    return nil
end

local ENTITIES = { amp = "&", lt = "<", gt = ">", quot = '"', apos = "'" }

local function unescape(s)
    return (string.gsub(s, "&(%a+);", function(e) return ENTITIES[e] or ("&" .. e .. ";") end))
end

-- Forms in an MA export file, as { name, graphs } for the confirmation text.
function M.parse_forms(text)
    local out = {}
    if type(text) ~= "string" or not string.find(text, "<MA[%s>]") then return out end
    for attrs, body in string.gmatch(text, "<Form(%s[^>]*)>(.-)</Form>") do
        local _, graphs = string.gsub(body, "<SubForm[%s>/]", "")
        out[#out + 1] = { name = unescape(string.match(attrs, 'name="([^"]*)"') or ""), graphs = graphs }
    end
    return out
end

function M.version(text)
    local a = string.match(text or "", 'major_vers="(%d+)"')
    local b = string.match(text or "", 'minor_vers="(%d+)"')
    local c = string.match(text or "", 'stream_vers="(%d+)"')
    if not (a and b and c) then return nil end
    return a .. "." .. b .. "." .. c
end

-- First fh_*.xml in a newest-first directory listing (dir /b or ls -t).
function M.newest(listing)
    for line in string.gmatch(listing or "", "[^\r\n]+") do
        local name = string.match(line, "([^/\\]+)$")
        if name and string.find(name, "^fh_.*%.[xX][mM][lL]$") then return name end
    end
    return nil
end

function M.list_cmd(dir, os_name)
    if os_name == "WINDOWS" then
        return string.format('dir /b /o-d "%s\\fh_*.xml" 2>nul', (string.gsub(dir, "/", "\\")))
    end
    return string.format('ls -t "%s"/fh_*.xml 2>/dev/null', dir)
end

-- getobj.name answers "Flyout 123": the label with the pool number appended.
function M.strip_number(name, number)
    if type(name) ~= "string" then return "?" end
    return (string.gsub(name, "%s+" .. tostring(number) .. "$", ""))
end

if not gma then return M end

-- ─── console half ─────────────────────────────────────────────

local O = gma.show.getobj

local function call1(fn, ...)
    if not fn then return nil end
    local ok, v = pcall(fn, ...)
    if ok then return v end
    return nil
end

local function note(fmt, ...)
    gma.echo("[" .. PLUGIN_TITLE .. "] " .. (select("#", ...) > 0 and string.format(fmt, ...) or fmt))
end

local function fail(msg)
    note(msg)
    call1(gma.gui.msgbox, PLUGIN_TITLE, msg)
end

local function form_handle(n)
    return call1(O.handle, "Form " .. n)
end

local function read_file(path)
    local f = io.open(path, "r")
    if not f then return nil end
    local text = f:read("*a")
    f:close()
    return text
end

local function newest_file(dir, os_name)
    if not io.popen then return nil end
    local p = call1(io.popen, M.list_cmd(dir, os_name))
    if not p then return nil end
    local listing = p:read("*a")
    p:close()
    return M.newest(listing)
end

local function describe(forms)
    local lines = {}
    for i, f in ipairs(forms) do
        lines[#lines + 1] = string.format("  %d. %s (%d graph%s)", i, f.name, f.graphs, f.graphs == 1 and "" or "s")
    end
    return table.concat(lines, "\n")
end

function Start()
    gma.echo("")
    note("start")
    local base = call1(gma.show.getvar, "PATH")
    local os_name = call1(gma.show.getvar, "OS") or ""
    local dir = base and (base .. "/importexport") or nil

    -- 1. Which drive. The internal drive can be checked before importing; a USB
    --    stick appears as another drive number (see the SelectDrive list).
    local drive_in = call1(gma.textinput, "Drive: 1 = internal, USB = its number in SelectDrive", "1")
    if drive_in == nil then return end
    local drive = M.parse_slot(drive_in)
    if not drive then return fail("Not a drive number: " .. tostring(drive_in)) end
    local internal = drive == 1

    -- 2. Which file. Default: the newest fh_*.xml in the internal importexport.
    local default = (internal and dir and newest_file(dir, os_name)) or "fh_"
    local file = M.xml_name(call1(gma.textinput, "Form file in importexport (from Form Helper)", default))
    if not file then return note("cancelled") end

    local forms
    if internal and dir then
        local text = read_file(dir .. "/" .. file)
        if not text then
            return fail("File not found:\n" .. dir .. "/" .. file ..
                "\n\nExport it from the Form Helper web page and copy it into this folder.")
        end
        forms = M.parse_forms(text)
        if #forms == 0 then return fail(file .. " holds no Form.\n\nIs it a Form Helper / MA Form export?") end
    end

    -- 3. Which slot. Default: the first empty one.
    local suggestion = M.first_empty(function(n) return form_handle(n) ~= nil end, 1, MAX_FORM)
    local slot = M.parse_slot(call1(gma.textinput, "Import into Form number", tostring(suggestion or "")))
    if not slot then return note("cancelled") end

    -- 4. Never replace a Form without asking.
    local count = forms and #forms or 1
    local occupied = {}
    for n = slot, slot + count - 1 do
        local h = form_handle(n)
        if h then occupied[#occupied + 1] = string.format("  Form %d: %s", n, M.strip_number(call1(O.name, h), n)) end
    end
    local question = string.format("Import %s into Form %d?", file, slot)
    if forms then question = question .. "\n\n" .. describe(forms) end
    if #occupied > 0 then
        question = question .. "\n\nThis REPLACES:\n" .. table.concat(occupied, "\n")
    end
    if not call1(gma.gui.confirm, PLUGIN_TITLE, question) then return note("cancelled") end

    -- 5. Import and check that it arrived.
    gma.cmd("SelectDrive " .. drive)
    local cmd = M.import_cmd(file, slot)
    note(cmd)
    gma.cmd(cmd)
    call1(gma.sleep, 0.5)
    local h = form_handle(slot)
    if not h then
        return fail(string.format("Nothing arrived in Form %d.\n\nCheck that %s is in the importexport folder of drive %d.", slot, file, drive))
    end
    local name = M.strip_number(call1(O.name, h), slot)
    note("Form %d is now %q", slot, name)
    gma.feedback(string.format("%s: Form %d = %s", PLUGIN_TITLE, slot, name))
    if not internal then note("drive %d is still selected", drive) end
end

function Cleanup() end

return Start, Cleanup
