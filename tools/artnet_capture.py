#!/usr/bin/env python3
"""Record grandMA2's Art-Net output and measure an effect's cycle and phases.

Used to calibrate the web app's effect preview (web/src/core/effect.ts) against
MA: how MA spreads Phase over fixtures, which way a negative phase runs, and
how long one cycle lasts at a given Effect Speed.

Setup on the onPC machine, in the lab show (form-helper-lab) only:
  1. Patch 8 dimmers on universe 1, channels 1-8.
  2. Setup > Network > Network Protocols: enable Art-Net output for universe 1
     (by default MA universe 1 goes out as Art-Net universe 0) to this computer
     or to broadcast on the shared network.
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
import json
import socket
import sys
import time

ARTNET_PORT = 6454
HEADER = b"Art-Net\x00"
OP_DMX = 0x5000
GRID = 0.005  # seconds between resampled points for analysis
MIN_CYCLES = 6  # fewer cycles than this and the numbers get noticeably rougher


def artdmx_packet(universe, data, sequence=0):
    """Build an ArtDmx packet (used by the tests; handy for trying the tool without a console)."""
    if len(data) % 2:
        data += b"\x00"  # Art-Net wants an even length
    return (
        HEADER
        + OP_DMX.to_bytes(2, "little")
        + bytes([0, 14, sequence, 0, universe & 0xFF, (universe >> 8) & 0x7F])
        + len(data).to_bytes(2, "big")
        + bytes(data)
    )


def parse_artdmx(packet):
    """(port-address universe, DMX data) of an ArtDmx packet, or None for anything else."""
    if len(packet) < 18 or packet[:8] != HEADER or int.from_bytes(packet[8:10], "little") != OP_DMX:
        return None
    universe = packet[14] | (packet[15] << 8)
    length = int.from_bytes(packet[16:18], "big")
    data = packet[18 : 18 + length]
    if len(data) < length:
        return None
    return universe, bytes(data)


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
        samples.append([round(clock() - start, 4)] + [data[c - 1] if c <= len(data) else 0 for c in channels])
    return samples


def resample(samples, column):
    """Values of one column on an even GRID, linearly interpolated between packets."""
    times = [s[0] for s in samples]
    out, k = [], 0
    t = times[0]
    while t <= times[-1]:
        while k + 1 < len(times) - 1 and times[k + 1] <= t:
            k += 1
        t0, t1 = times[k], times[k + 1]
        v0, v1 = samples[k][column], samples[k + 1][column]
        out.append(v0 if t1 == t0 else v0 + (v1 - v0) * (t - t0) / (t1 - t0))
        t += GRID
    return out


def centred(values):
    mean = sum(values) / len(values)
    return [v - mean for v in values]


def peak(f, i):
    """Sub-sample position of a peak at index i from f(i-1), f(i), f(i+1)."""
    a, b, c = f(i - 1), f(i), f(i + 1)
    d = a - 2 * b + c
    return i + (0.5 * (a - c) / d if d else 0)


def find_period(x):
    """Cycle length of x in grid steps: the first autocorrelation peak after it dips below zero."""
    n = len(x)
    energy = sum(v * v for v in x) / n
    if energy < 1e-6:
        raise ValueError("the first channel does not change; is the effect running?")

    cache = {}

    def r(lag):
        if lag not in cache:
            cache[lag] = sum(x[i] * x[i + lag] for i in range(n - lag)) / (n - lag) / energy
        return cache[lag]

    dipped = False
    for lag in range(1, n // 2):
        if r(lag) < 0:
            dipped = True
        elif dipped and r(lag) > 0.5 and r(lag) >= r(lag - 1) and r(lag) >= r(lag + 1):
            return peak(r, lag)
    raise ValueError("no repeating cycle found; capture at least two cycles")


def phase_of(x, y, period):
    """How far y runs behind x, as a fraction of the cycle in [0, 1)."""
    n = len(x)
    steps = round(period)

    def c(lag):
        if lag < 0:
            return sum(x[i - lag] * y[i] for i in range(n + lag)) / (n + lag)
        return sum(x[i] * y[i + lag] for i in range(n - lag)) / (n - lag)

    best = max(range(steps), key=c)
    return (peak(c, best) / period) % 1


def analyze(samples):
    """Cycle length (s) and, per channel, phase relative to the first channel and its range."""
    columns = len(samples[0]) - 1
    series = [resample(samples, k + 1) for k in range(columns)]
    first = centred(series[0])
    period = find_period(first)
    channels = []
    for values in series:
        lag = phase_of(first, centred(values), period)
        phase = (-360 * lag) % 360
        if phase > 0.5:
            phase -= 360  # (-359.5, 0.5]: a tiny lead of the first channel reads 0, not -360
        channels.append({
            "phase_deg": round(phase, 1) + 0.0,  # never -0.0
            "min_percent": round(min(values) / 2.55, 1),
            "max_percent": round(max(values) / 2.55, 1),
        })
    span = samples[-1][0] - samples[0][0]
    return {"cycle_seconds": period * GRID, "cycles": span / (period * GRID), "channels": channels}


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
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)  # share the port with other Art-Net apps
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
    result = analyze(data["samples"])
    cycle = result["cycle_seconds"]
    out(f"cycle {cycle:.3f} s ({60 / cycle:.2f} cycles per minute), {result['cycles']:.1f} cycles captured")
    if result["cycles"] < MIN_CYCLES:
        out(f"warning: fewer than {MIN_CYCLES} cycles captured; capture longer for accurate numbers")
    for channel, info in zip(data["channels"], result["channels"]):
        out(f"ch {channel:>2}  phase {info['phase_deg']:7.1f}°  range {info['min_percent']:.1f}-{info['max_percent']:.1f} %")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
