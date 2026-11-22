#!/usr/bin/env python3
"""Drive a grandMA2 onPC test machine from a dev box: telnet commands + file transfer.

Used to verify that XML written by the web tool imports into MA exactly as intended.
Every command that writes to the show refuses to run unless the loaded show is the
lab show (default "form-helper-lab"), so a real showfile is never touched.

Configuration (environment variables):
  MA2_HOST        IP of the Windows machine running onPC        (required)
  MA2_SSH_USER    Windows account for ssh/scp                    (default: user)
  MA2_SSH_KEY     private key for ssh/scp                        (default: ~/.ssh/gma2_win)
  MA2_VERSION_DIR onPC data folder name                          (default: gma2_V_3.9.60)
  MA2_LAB_SHOW    show name that write commands require          (default: form-helper-lab)
  MA2_LOGIN       telnet login user / password                   (default: administrator / admin)

Usage:
  ma2lab.py run 'List Form' 'Version'           run raw commands, print output
  ma2lab.py import file.xml 101                  upload, import at Form 101, list points back
  ma2lab.py list 101                             list every graph's points of Form 101
  ma2lab.py export '1 Thru 23' name out_dir      export forms and download the XML
"""

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


def parse_showfile(text):
    m = re.search(r"Showfile is '([^']*)'", text)
    return m.group(1) if m else None


def telnet(commands, wait=1.5):
    """Log in, run each command, return the cleaned transcript."""
    user, password = env("MA2_LOGIN", "administrator/admin").split("/", 1)
    s = socket.create_connection((env("MA2_HOST"), TELNET_PORT), timeout=10)
    s.settimeout(0.5)
    out = b""

    def drain(seconds):
        nonlocal out
        end = time.time() + seconds
        while time.time() < end:
            try:
                data = s.recv(65536)
            except socket.timeout:
                continue
            if not data:
                break
            out += data

    drain(1.5)
    for cmd in [f'Login "{user}" "{password}"', *commands]:
        s.sendall((cmd + "\r\n").encode())
        drain(wait)
    s.close()
    out = re.sub(rb"\xff[\xfb-\xfe].", b"", out)
    out = re.sub(rb"\x1b\[[0-9;]*[A-Za-z]", b"", out)
    text = out.decode("utf-8", "replace")
    if "Remote commandline disabled" in text:
        sys.exit("Telnet is disabled on the console (Setup > Console > Global Settings > Telnet)")
    return text


def ssh_target(path):
    return f"{env('MA2_SSH_USER', 'user')}@{env('MA2_HOST')}:{path}"


def importexport_dir():
    return f"C:/ProgramData/MA Lighting Technologies/grandma/{env('MA2_VERSION_DIR', 'gma2_V_3.9.60')}/importexport"


def scp(src, dst):
    key = os.path.expanduser(env("MA2_SSH_KEY", "~/.ssh/gma2_win"))
    subprocess.run(["scp", "-q", "-i", key, "-o", "BatchMode=yes", src, dst], check=True)


def require_lab_show():
    show = parse_showfile(telnet(["Version"]))
    lab = env("MA2_LAB_SHOW", "form-helper-lab")
    if show != lab:
        sys.exit(f"Refusing to write: loaded show is {show!r}, expected lab show {lab!r}")


def graph_count(form_no):
    text = telnet([f"List Form {form_no}.*"])
    return sum(1 for line in text.splitlines() if GRAPH_RE.match(line.strip()))


def list_form(form_no):
    """{graph_no: [(x, y, mode_label)]} for every graph of a Form."""
    result = {}
    for g in range(1, graph_count(form_no) + 1):
        text = telnet([f"cd Form {form_no}", f"cd {g}", "List", "cd /"])
        result[g] = parse_point_list(text)
    return result


def print_form(form_no):
    for g, points in list_form(form_no).items():
        print(f"[{g}]")
        for x, y, mode in points:
            print(f"  {x:7.2f} {y:7.2f}  {mode}")


def main(argv):
    if len(argv) < 2:
        sys.exit(__doc__)
    cmd, args = argv[1], argv[2:]
    if cmd == "run":
        print(telnet(args))
    elif cmd == "list":
        print_form(args[0])
    elif cmd == "import":
        path, form_no = args
        require_lab_show()
        scp(path, ssh_target(importexport_dir() + "/"))
        name = os.path.splitext(os.path.basename(path))[0]
        out = telnet([f'Import "{name}" At Form {form_no} /o'])
        if "imported" not in out:
            sys.exit(out)
        print_form(form_no)
    elif cmd == "export":
        objects, name, out_dir = args
        telnet([f'Export Form {objects} "{name}" /o'])
        os.makedirs(out_dir, exist_ok=True)
        scp(ssh_target(f"{importexport_dir()}/{name}.xml"), out_dir)
        print(os.path.join(out_dir, name + ".xml"))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
