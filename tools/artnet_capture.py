#!/usr/bin/env python3
"""Record grandMA2's Art-Net output and measure an effect's cycle and phases.

Used to calibrate the web app's effect preview (web/src/core/effect.ts) against
MA: how MA spreads Phase over fixtures, which way a negative phase runs, and
how long one cycle lasts at a given Effect Speed.

Setup on the onPC machine, in the lab show (form-helper-lab) only:
  1. Patch 8 dimmers on universe 1, channels 1-8.
  2. Setup > Network > Network Protocols: enable Art-Net output for universe 1
     (by default MA universe 1 goes out as Art-Net universe 0), as broadcast on
     the shared network or unicast to this computer. With unicast, close other
     Art-Net software here: only the first program listening gets the packets.
  3. Run the effect, e.g. a Form as a dimmer effect, Phase 0 Thru -360.

Usage:
  artnet_capture.py capture --channels 1-8 --seconds 20 --out capture.json
        [--universe 0] [--bind 0.0.0.0] [--port 6454]
  artnet_capture.py analyze capture.json

capture writes {"universe", "channels", "samples": [[t, v1, v2, ...], ...]},
with t in seconds and values 0-255. Capture at least 6 cycles (20 s at Effect
Speed 30 is 10 cycles); shorter captures give rougher numbers. analyze prints the cycle length and, for
each channel, how far it runs behind the first channel, in MA's convention: a
channel that lags gets a negative phase, in (-360, 0]. A lead of 90 reads -270.
"""

import argparse
import bisect
import cmath
import functools
import json
import math
import socket
import struct
import sys
import time
from operator import mul
from statistics import fmean

ARTNET_PORT = 6454
HEADER = b"Art-Net\x00"
OP_DMX = 0x5000
# Art-Net header, OpCode, protocol version 14, sequence, physical, port-address (little-endian)
# and the data length (big-endian, its own struct).
DMX_HEAD = struct.Struct("<8sHBBBBH")
DMX_LENGTH = struct.Struct(">H")
GRID = 0.01  # seconds between resampled points for analysis (Art-Net runs at about 30-44 Hz)
MIN_CYCLES = 6  # fewer cycles than this and the numbers get noticeably rougher


def artdmx_packet(universe, data):
    """Build an ArtDmx packet (used by the tests; handy for trying the tool without a console)."""
    if len(data) % 2:
        data += b"\x00"  # Art-Net wants an even length
    return DMX_HEAD.pack(HEADER, OP_DMX, 0, 14, 0, 0, universe & 0x7FFF) + DMX_LENGTH.pack(len(data)) + data


def parse_artdmx(packet):
    """(port-address universe, DMX data) of an ArtDmx packet, or None for anything else."""
    if len(packet) < DMX_HEAD.size + DMX_LENGTH.size:
        return None
    header, opcode, *_, universe = DMX_HEAD.unpack_from(packet)
    if header != HEADER or opcode != OP_DMX:
        return None
    (length,) = DMX_LENGTH.unpack_from(packet, DMX_HEAD.size)
    data = packet[DMX_HEAD.size + DMX_LENGTH.size :][:length]
    return (universe & 0x7FFF, data) if len(data) == length else None  # Net is 7 bits


def parse_channels(text):
    """'1-8' or '3,1,10-11' -> list of DMX channels (1-512)."""
    channels = []
    for part in text.split(","):
        first, _, last = part.strip().partition("-")
        lo, hi = int(first), int(last or first)
        if not 1 <= lo <= hi <= 512:
            raise ValueError(f"channels must be within 1-512: {part!r}")
        channels.extend(range(lo, hi + 1))
    return channels


def capture(sock, universe, channels, seconds, clock=time.monotonic):
    """Read ArtDmx from sock for `seconds`; one [t, values...] row per packet of `universe`."""
    samples = []
    start = clock()
    deadline = start + seconds
    while (remaining := deadline - clock()) > 0:
        sock.settimeout(remaining)
        try:
            packet, _ = sock.recvfrom(1024)
        except socket.timeout:
            break
        parsed = parse_artdmx(packet)
        if parsed is None or parsed[0] != universe:
            continue
        data = parsed[1]
        samples.append([clock() - start] + [data[c - 1] if c <= len(data) else 0 for c in channels])
    return samples


def resample(times, values):
    """values on an even GRID from times[0] to times[-1], linearly interpolated between packets."""
    out = []
    steps = int((times[-1] - times[0]) / GRID)
    for j in range(steps + 1):
        t = times[0] + j * GRID
        k = min(bisect.bisect_right(times, t) - 1, len(times) - 2)
        t0, t1 = times[k], times[k + 1]
        v0, v1 = values[k], values[k + 1]
        out.append(v0 if t1 == t0 else v0 + (v1 - v0) * (t - t0) / (t1 - t0))  # packets read in one burst share a time
    return out


def centred(values):
    mean = fmean(values)
    return [v - mean for v in values]


def peak(f, i):
    """Sub-sample position of a peak at index i from f(i-1), f(i), f(i+1)."""
    a, b, c = f(i - 1), f(i), f(i + 1)
    d = a - 2 * b + c
    return i + (0.5 * (a - c) / d if d else 0)


def find_period(x):
    """Cycle length of x in grid steps: the first autocorrelation peak after it dips below zero."""
    n = len(x)
    energy = fmean(v * v for v in x)
    if energy < 1e-6:
        raise ValueError("the first channel does not change; is the effect running?")

    @functools.cache
    def r(lag):
        return sum(map(mul, x[: n - lag], x[lag:])) / (n - lag) / energy

    dipped = False
    for lag in range(1, n // 2):
        if r(lag) < 0:
            dipped = True
        elif dipped and r(lag) > 0.5 and r(lag) >= r(lag - 1) and r(lag) >= r(lag + 1):
            return peak(r, lag)
    raise ValueError("no repeating cycle found; capture at least two cycles")


def fundamental(x, period):
    """The cycle-rate Fourier component of x over a whole number of cycles."""
    length = round(int(len(x) / period) * period)
    w = -2j * math.pi / period
    return sum(v * cmath.exp(w * i) for i, v in enumerate(x[:length]))


def ma_phase(lag):
    """A lag in cycles as MA's phase: negative, in (-360, 0], one decimal.

    Phase repeats every cycle, so a lead reads as the matching lag. The second
    % 360 turns a lag that rounds to a whole cycle into 0, not -360.
    """
    return 0.0 - round(360 * lag % 360, 1) % 360


def analyze(samples):
    """Cycle length (s) and, per channel, phase relative to the first channel and its range.

    Every channel of a phase-spread effect is the same waveform shifted in time,
    so the shift is the angle between the channels' cycle-rate components.
    """
    if len(samples) < 2:
        raise ValueError(f"{len(samples)} packets captured; is Art-Net reaching this computer?")
    times = [s[0] for s in samples]
    columns = [[s[k] for s in samples] for k in range(1, len(samples[0]))]
    series = [centred(resample(times, values)) for values in columns]
    period = find_period(series[0])
    cycle = period * GRID
    reference = fundamental(series[0], period)
    channels = []
    for values, raw in zip(series, columns):
        z = fundamental(values, period)
        lag = (cmath.phase(reference) - cmath.phase(z)) / (2 * math.pi)  # cycles behind the first channel
        follows = abs(z) > 1e-3 * abs(reference)  # a channel outside the effect has no phase
        channels.append({
            "phase_deg": ma_phase(lag) if follows else None,
            "min_percent": round(min(raw) / 2.55, 1),
            "max_percent": round(max(raw) / 2.55, 1),
        })
    return {"cycle_seconds": cycle, "cycles": (times[-1] - times[0]) / cycle, "channels": channels}


def main(argv, out=print):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    cap = sub.add_parser("capture", help="record Art-Net to a JSON file")
    cap.add_argument("--universe", type=int, default=0, help="Art-Net port-address (MA universe 1 = 0)")
    cap.add_argument("--channels", type=parse_channels, default=parse_channels("1-8"))
    cap.add_argument("--seconds", type=float, default=20.0, help=f"capture at least {MIN_CYCLES} cycles")
    cap.add_argument("--out", required=True)
    cap.add_argument("--bind", default="0.0.0.0")
    cap.add_argument("--port", type=int, default=ARTNET_PORT)
    ana = sub.add_parser("analyze", help="print cycle length and phases of a capture")
    ana.add_argument("file")
    args = parser.parse_args(argv)

    if args.command == "capture":
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if hasattr(socket, "SO_REUSEPORT"):
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)  # lets other Art-Net apps hear broadcast too
        sock.bind((args.bind, args.port))
        try:
            samples = capture(sock, args.universe, args.channels, args.seconds)
        finally:
            sock.close()
        with open(args.out, "w") as f:
            json.dump({"universe": args.universe, "channels": args.channels, "samples": samples}, f)
        out(f"{len(samples)} packets from universe {args.universe} -> {args.out}")
        return 0 if samples else 1

    with open(args.file) as f:
        data = json.load(f)
    try:
        result = analyze(data["samples"])
    except ValueError as e:
        out(f"error: {e}")
        return 1
    cycle = result["cycle_seconds"]
    out(f"cycle {cycle:.3f} s ({60 / cycle:.2f} cycles per minute), {result['cycles']:.1f} cycles captured")
    if result["cycles"] < MIN_CYCLES:
        out(f"warning: fewer than {MIN_CYCLES} cycles captured; capture longer for accurate numbers")
    for channel, info in zip(data["channels"], result["channels"]):
        phase = "no cycle" if info["phase_deg"] is None else f"{info['phase_deg']:7.1f}°"
        out(f"ch {channel:>2}  phase {phase:>8}  range {info['min_percent']:.1f}-{info['max_percent']:.1f} %")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
