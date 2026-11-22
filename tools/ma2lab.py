#!/usr/bin/env python3
"""Drive a grandMA2 onPC test machine from a dev box: telnet commands + file transfer.

Used to verify that XML written by the web tool imports into MA exactly as intended.
Every subcommand refuses to run unless the loaded show is the lab show
(default "form-helper-lab"), so a real showfile is never touched; `run` re-checks
after each command in case one of them loads another show.

Configuration (environment variables):
  MA2_HOST        IP of the Windows machine running onPC        (required)
  MA2_SSH_USER    Windows account for ssh/scp                    (default: user)
  MA2_SSH_KEY     private key for ssh/scp                        (default: ~/.ssh/gma2_win)
  MA2_VERSION_DIR onPC data folder name                          (default: gma2_V_3.9.60)
  MA2_LAB_SHOW    show name every subcommand requires            (default: form-helper-lab)
  MA2_LOGIN       telnet login user / password                   (default: administrator / admin)

Usage:
  ma2lab.py run 'List Form' 'Version'           run raw commands (lab show only), print output
  ma2lab.py import file.xml 101 [--json]         upload, replace Form 101 with it, list points back
  ma2lab.py list 101 [--json]                    list every graph's points of Form 101
  ma2lab.py export '1 Thru 23' name out_dir      export forms and download the XML
"""

import json
import os
import re
import socket
import subprocess
import sys
import time

TELNET_PORT = 30000
POINT_RE = re.compile(r"^SubFormPoint\s+\d+\s+\d+\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(.+?)\s*$")
GRAPH_RE = re.compile(r"^SubForm\s+\S+\s+\S+")


def env(name, default=None):
    value = os.environ.get(name, default)
    if value is None:
        sys.exit(f"Set {name} (see tools/ma2lab.py header)")
    return value


def parse_point_list(text):
    """Points from the output of `List` inside a SubForm: [(x, y, mode_label)]."""
    points = []
    for line in text.splitlines():
        m = POINT_RE.match(line.strip())
        if m:
            points.append((float(m.group(1)), float(m.group(2)), m.group(3)))
    return points


ARG_PATTERNS = {
    "form": re.compile(r"[0-9]+"),
    "objects": re.compile(r"[0-9]+( Thru [0-9]+)?"),
    "name": re.compile(r"[A-Za-z0-9_-]+"),
}


def check_arg(kind, value):
    """Arguments are pasted into MA commands, so only allow plain numbers, ranges and names."""
    if not ARG_PATTERNS[kind].fullmatch(value):
        sys.exit(f"Invalid {kind}: {value!r}")
    return value


def parse_showfile(text):
    m = re.search(r"Showfile is '([^']*)'", text)
    return m.group(1) if m else None


PROMPT_RE = re.compile(r">\s*$")


class Session:
    """One logged-in telnet session. cmd() returns that command's output."""

    def __init__(self):
        user, password = env("MA2_LOGIN", "administrator/admin").split("/", 1)
        self.sock = socket.create_connection((env("MA2_HOST"), TELNET_PORT), timeout=10)
        self.sock.settimeout(0.1)
        self._read()
        out = self.cmd(f'Login "{user}" "{password}"')
        if "Remote commandline disabled" in out:
            sys.exit("Telnet is disabled on the console (Setup > Console > Global Settings > Telnet)")

    def _read(self, timeout=10.0, quiet=0.2):
        """Read until the console prompt shows and the line goes quiet. Fails loudly on timeout."""
        buf = b""
        end = time.time() + timeout
        last = time.time()
        while time.time() < end:
            try:
                data = self.sock.recv(65536)
            except socket.timeout:
                if buf and PROMPT_RE.search(clean(buf)) and time.time() - last >= quiet:
                    return clean(buf)
                continue
            if not data:
                break
            buf += data
            last = time.time()
        sys.exit(f"No console prompt within {timeout:.0f}s; partial output:\n{clean(buf)}")

    def cmd(self, command, timeout=10.0):
        self.sock.sendall((command + "\r\n").encode())
        return self._read(timeout)

    def close(self):
        self.sock.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def clean(raw):
    raw = re.sub(rb"\xff[\xfb-\xfe].", b"", raw)
    raw = re.sub(rb"\x1b\[[0-9;]*[A-Za-z]", b"", raw)
    return raw.decode("utf-8", "replace")


def ssh_target(path):
    return f"{env('MA2_SSH_USER', 'user')}@{env('MA2_HOST')}:{path}"


def importexport_dir():
    return f"C:/ProgramData/MA Lighting Technologies/grandma/{env('MA2_VERSION_DIR', 'gma2_V_3.9.60')}/importexport"


def scp(src, dst):
    key = os.path.expanduser(env("MA2_SSH_KEY", "~/.ssh/gma2_win"))
    subprocess.run(["scp", "-q", "-i", key, "-o", "BatchMode=yes", src, dst], check=True)


def require_lab_show(session):
    show = parse_showfile(session.cmd("Version"))
    lab = env("MA2_LAB_SHOW", "form-helper-lab")
    if show != lab:
        sys.exit(f"Refusing to run: loaded show is {show!r}, expected lab show {lab!r}")


def list_form(session, form_no):
    """{graph_no: [(x, y, mode_label)]} for every graph of a Form."""
    listing = session.cmd(f"List Form {form_no}.*")
    count = sum(1 for line in listing.splitlines() if GRAPH_RE.match(line.strip()))
    result = {}
    for g in range(1, count + 1):
        session.cmd(f"cd Form {form_no}")
        session.cmd(f"cd {g}")
        result[g] = parse_point_list(session.cmd("List"))
        session.cmd("cd /")
    return result


def print_form(form, as_json):
    if as_json:
        print(json.dumps({str(g): pts for g, pts in form.items()}))
        return
    for g, points in form.items():
        print(f"[{g}]")
        for x, y, mode in points:
            print(f"  {x:7.2f} {y:7.2f}  {mode}")


def main(argv):
    args = [a for a in argv[1:] if a != "--json"]
    as_json = "--json" in argv
    if not args:
        sys.exit(__doc__)
    cmd, args = args[0], args[1:]
    if (cmd, len(args)) not in {("list", 1), ("import", 2), ("export", 3)} and not (cmd == "run" and args):
        sys.exit(__doc__)
    with Session() as session:
        require_lab_show(session)
        if cmd == "run":
            for c in args:
                print(session.cmd(c, timeout=60))
                require_lab_show(session)
        elif cmd == "list":
            print_form(list_form(session, check_arg("form", args[0])), as_json)
        elif cmd == "import":
            path, form_no = args[0], check_arg("form", args[1])
            name = check_arg("name", os.path.splitext(os.path.basename(path))[0])
            scp(path, ssh_target(importexport_dir() + "/"))
            # Import into an occupied slot opens an Overwrite Confirmation (even with /o),
            # so clear the lab slot first.
            session.cmd(f"Delete Form {form_no} /nc")
            out = session.cmd(f'Import "{name}" At Form {form_no}', timeout=60)
            if "imported" not in out:
                sys.exit(out)
            print_form(list_form(session, form_no), as_json)
        elif cmd == "export":
            objects, name, out_dir = check_arg("objects", args[0]), check_arg("name", args[1]), args[2]
            session.cmd(f'Export Form {objects} "{name}" /o', timeout=60)
            os.makedirs(out_dir, exist_ok=True)
            scp(ssh_target(f"{importexport_dir()}/{name}.xml"), out_dir)
            print(os.path.join(out_dir, name + ".xml"))
        else:
            sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
