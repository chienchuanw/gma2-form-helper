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
--   * Import into an occupied slot opens MA's Overwrite Confirmation on screen
--     (also when a plugin runs the command; the plugin waits for the answer).
--     "/nc" replaces silently instead. So: when the file can be read, the plugin
--     shows every slot it will fill, asks, and imports with /nc; when it cannot
--     (USB), it imports without /nc and MA asks.
--   * A file with several Forms fills consecutive slots from the target on.
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

-- confirmed: the plugin has asked about every slot the file fills, so /nc keeps
-- MA from asking again. Otherwise MA's own Overwrite Confirmation asks.
function M.import_cmd(file, slot, confirmed)
    return string.format('Import "%s" At Form %d%s', file, slot, confirmed and " /nc" or "")
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
-- Handles both <Form ...>...</Form> and self-closing <Form ... />.
function M.parse_forms(text)
    local out = {}
    if type(text) ~= "string" or not string.find(text, "<MA[%s>]") then return out end
    local pos = 1
    while true do
        local s, e, attrs = string.find(text, "<Form(%s[^>]*)>", pos)
        if not s then break end
        local name = unescape(string.match(attrs, 'name="([^"]*)"') or "")
        local graphs = 0
        pos = e + 1
        if string.sub(attrs, -1) ~= "/" then
            local close = string.find(text, "</Form>", pos, true)
            local body = string.sub(text, pos, (close or (#text + 1)) - 1)
            local _, n = string.gsub(body, "<SubForm[%s>/]", "")
            graphs = n
            pos = close and (close + 7) or (#text + 1)
        end
        out[#out + 1] = { name = name, graphs = graphs }
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

-- Did the import land? before/after are { name } of the target slot (nil when
-- empty); expected is the first Form's name in the file, if known. A replaced
-- Form keeps its handle (lab-verified on 3.9.60), so only a changed name proves
-- the import, and re-importing a same-name Form can only be "unknown".
-- Returns "yes", "no" or "unknown".
function M.imported(before, after, expected)
    if not after then return "no" end
    if not before then return "yes" end
    if expected then
        if after.name ~= expected then return "no" end
        return before.name == expected and "unknown" or "yes"
    end
    return after.name ~= before.name and "yes" or "unknown"
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

local function slot_info(n)
    local h = form_handle(n)
    if not h then return nil end
    return { name = M.strip_number(call1(O.name, h), n) }
end

-- Ask for text; nil means the user cancelled.
local function ask(title, default)
    return call1(gma.textinput, title, default)
end

function Start()
    gma.echo("")
    note("start")
    local base = call1(gma.show.getvar, "PATH")
    local os_name = call1(gma.show.getvar, "OS") or ""
    local dir = base and (base .. "/importexport") or nil

    -- 1. Which drive. Only the internal drive can be read before importing; a
    --    USB stick appears as another drive number (see the SelectDrive list).
    local drive_in = ask("Drive (1 = internal)", "1")
    if drive_in == nil then return note("cancelled") end
    local drive = M.parse_slot(drive_in)
    if not drive then
        return fail("Not a drive number: " .. tostring(drive_in) ..
            "\n\nType SelectDrive in the command line to see the drive numbers;\na USB stick is listed there once it is plugged in.")
    end
    local internal = drive == 1

    -- 2. Which file. Default: the newest fh_*.xml in the internal importexport.
    local default = (internal and dir and newest_file(dir, os_name)) or "fh_"
    local file_in = ask("Form file (importexport)", default)
    if file_in == nil then return note("cancelled") end
    local file = M.xml_name(file_in)
    if not file then return fail("Not a usable file name: " .. tostring(file_in)) end

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
    local slot_in = ask("Import into Form", tostring(suggestion or ""))
    if slot_in == nil then return note("cancelled") end
    local slot = M.parse_slot(slot_in)
    if not slot then return fail("Not a Form number: " .. tostring(slot_in)) end
    if forms and slot + #forms - 1 > MAX_FORM then
        return fail(string.format("%d Forms starting at Form %d would run past Form %d.", #forms, slot, MAX_FORM))
    end

    -- 4. Never replace a Form without asking. With a readable file the plugin
    --    asks about every slot it fills; otherwise MA's own dialog asks.
    local question
    if forms then
        local occupied = {}
        for n = slot, slot + #forms - 1 do
            local info = slot_info(n)
            if info then occupied[#occupied + 1] = string.format("  Form %d: %s", n, info.name) end
        end
        question = string.format("Import %s into Form %d%s?\n\n%s", file, slot,
            #forms > 1 and string.format("-%d", slot + #forms - 1) or "", describe(forms))
        if #occupied > 0 then question = question .. "\n\nThis REPLACES:\n" .. table.concat(occupied, "\n") end
    else
        question = string.format("Import %s from drive %d into Form %d?\n\n" ..
            "The file cannot be previewed on this drive. If it would replace\nexisting Forms, MA asks before doing so.", file, drive, slot)
    end
    if not call1(gma.gui.confirm, PLUGIN_TITLE, question) then return note("cancelled") end

    -- 5. Import and check that it really arrived.
    local before = slot_info(slot)
    gma.cmd("SelectDrive " .. drive)
    local cmd = M.import_cmd(file, slot, forms ~= nil)
    note(cmd)
    gma.cmd(cmd)
    call1(gma.sleep, 0.5)
    local after = slot_info(slot)
    local result = M.imported(before, after, forms and forms[1].name or nil)
    if result == "no" then
        local now = after and string.format("Form %d still holds %q.", slot, after.name) or string.format("Form %d is empty.", slot)
        return fail(string.format("%s was not imported.\n\n%s\nThe import was cancelled, or %s is not in the\nimportexport folder of drive %d.", file, now, file, drive))
    end
    if result == "unknown" then
        note("Form %d still holds %q: the import cannot be confirmed", slot, after.name)
        call1(gma.gui.msgbox, PLUGIN_TITLE, string.format("Form %d holds %q, as it did before.\n\n" ..
            "Either the import replaced it with a Form of the same name, or nothing\n" ..
            "was imported (cancelled, or %s is not on drive %d).\nCheck the Form to be sure.", slot, after.name, file, drive))
        gma.feedback(string.format("%s: Form %d unconfirmed (%s)", PLUGIN_TITLE, slot, after.name))
    else
        note("Form %d is now %q", slot, after.name)
        gma.feedback(string.format("%s: Form %d = %s", PLUGIN_TITLE, slot, after.name))
    end
    if not internal then note("drive %d is still selected", drive) end
end

function Cleanup() end

return Start, Cleanup
