import json
import random
import socket
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))  # runnable from the repo root too

from artnet_capture import HEADER, analyze, artdmx_packet, capture, main, parse_artdmx, parse_channels


def triangle(u):
    """0 at u = 0, 1 at u = 0.5, back to 0 at u = 1 (the editor's default Form)."""
    u %= 1
    return 2 * u if u < 0.5 else 2 * (1 - u)


def lopsided(u):
    """Peak at u = 0.25, so a phase shift and its mirror image differ."""
    u %= 1
    return u / 0.25 if u < 0.25 else (1 - u) / 0.75


def synthetic(form, period, lags, seconds=10.0, rate=40.0, jitter=0.004, seed=1):
    """Samples like a capture: channel k reads form(t / period - lags[k]) as 8-bit DMX, at about `rate` packets a second."""
    rng = random.Random(seed)
    samples, t = [], 0.0
    while t < seconds:
        values = [round(255 * form(t / period - lag)) for lag in lags]
        samples.append([round(t, 4)] + values)
        t += 1 / rate + rng.uniform(-jitter, jitter)
    return samples


class ParseTests(unittest.TestCase):
    def test_reads_universe_and_channel_values_from_artdmx(self):
        packet = artdmx_packet(universe=0x123, data=bytes([0, 128, 255, 7]))

        self.assertEqual(parse_artdmx(packet), (0x123, bytes([0, 128, 255, 7])))

    def test_pads_odd_data_to_the_even_length_art_net_requires(self):
        self.assertEqual(parse_artdmx(artdmx_packet(universe=0, data=bytes([1, 2, 3]))), (0, bytes([1, 2, 3, 0])))

    def test_ignores_other_packets(self):
        poll = HEADER + (0x2000).to_bytes(2, "little") + bytes([0, 14, 0, 0])
        self.assertIsNone(parse_artdmx(poll))
        self.assertIsNone(parse_artdmx(b"hello"))
        self.assertIsNone(parse_artdmx(HEADER + b"\x00\x50"))  # cut short

    def test_ignores_data_shorter_than_its_length_field(self):
        packet = artdmx_packet(universe=0, data=bytes(4))[:-2]
        self.assertIsNone(parse_artdmx(packet))

    def test_reads_channel_lists_and_ranges(self):
        self.assertEqual(parse_channels("1-8"), [1, 2, 3, 4, 5, 6, 7, 8])
        self.assertEqual(parse_channels("3,1,10-11"), [3, 1, 10, 11])
        with self.assertRaises(ValueError):
            parse_channels("0")
        with self.assertRaises(ValueError):
            parse_channels("510-513")


class AnalyzeTests(unittest.TestCase):
    def test_finds_the_cycle_length(self):
        samples = synthetic(triangle, period=2.0, lags=[0])

        self.assertAlmostEqual(analyze(samples)["cycle_seconds"], 2.0, delta=0.02)

    def test_finds_a_slow_cycle(self):
        samples = synthetic(lopsided, period=3.7, lags=[0], seconds=15)

        self.assertAlmostEqual(analyze(samples)["cycle_seconds"], 3.7, delta=0.037)

    def test_reports_each_channel_phase_against_the_first_with_lag_negative(self):
        # 8 fixtures at 0 Thru -360 if MA spreads by i/8: fixture i is i/8 of a cycle behind.
        lags = [i / 8 for i in range(8)]
        result = analyze(synthetic(lopsided, period=2.0, lags=lags))

        phases = [c["phase_deg"] for c in result["channels"]]
        for got, want in zip(phases, [-45 * i for i in range(8)]):
            self.assertAlmostEqual(got, want, delta=2)
            self.assertEqual(got, round(got, 1))  # one decimal, no float noise

    def test_reports_a_lead_as_the_same_lag(self):
        # Phase repeats every cycle: a quarter cycle ahead is three quarters behind.
        result = analyze(synthetic(lopsided, period=2.0, lags=[0, -0.25]))

        self.assertAlmostEqual(result["channels"][1]["phase_deg"], -270, delta=2)

    def test_keeps_the_first_channel_at_zero_rather_than_minus_360(self):
        result = analyze(synthetic(lopsided, period=2.0, lags=[0, 0.5]))

        self.assertAlmostEqual(result["channels"][0]["phase_deg"], 0, delta=0.5)

    def test_reports_the_range_in_percent(self):
        low_high = lambda u: 0.2 + 0.6 * triangle(u)  # Low 20, High 80
        result = analyze(synthetic(low_high, period=2.0, lags=[0]))

        self.assertAlmostEqual(result["channels"][0]["min_percent"], 20, delta=0.5)
        self.assertAlmostEqual(result["channels"][0]["max_percent"], 80, delta=0.5)

    def test_reports_no_phase_for_a_channel_outside_the_effect(self):
        samples = [row + [128] for row in synthetic(lopsided, period=2.0, lags=[0])]

        self.assertIsNone(analyze(samples)["channels"][1]["phase_deg"])

    def test_refuses_a_capture_without_a_repeating_cycle(self):
        flat = [[t / 40, 128] for t in range(400)]
        with self.assertRaises(ValueError):
            analyze(flat)


def send_and_capture(packets, channels, seconds=0.2):
    """Send packets to a fresh listener on localhost, then capture them."""
    listener = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sender = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        listener.bind(("127.0.0.1", 0))
        for packet in packets:
            sender.sendto(packet, listener.getsockname())
        return capture(listener, universe=0, channels=channels, seconds=seconds)
    finally:
        listener.close()
        sender.close()


def run_analyze(samples, channels):
    """Output lines of `analyze` on a capture file holding samples."""
    with tempfile.TemporaryDirectory() as d:
        path = Path(d) / "capture.json"
        path.write_text(json.dumps({"universe": 0, "channels": channels, "samples": samples}))
        out = []
        main(["analyze", str(path)], out=out.append)
    return "\n".join(out)


class CaptureTests(unittest.TestCase):
    def test_records_packets_sent_to_the_socket(self):
        samples = send_and_capture(
            [artdmx_packet(universe=1, data=bytes([9] * 8))]  # another universe
            + [artdmx_packet(universe=0, data=bytes([level, level + 1, 0, 0])) for level in (10, 20, 30)]
            + [b"not art-net"],
            channels=[1, 2],
        )

        self.assertEqual([s[1:] for s in samples], [[10, 11], [20, 21], [30, 31]])
        times = [s[0] for s in samples]
        self.assertEqual(times, sorted(times))

    def test_reads_missing_channels_as_zero(self):
        samples = send_and_capture([artdmx_packet(universe=0, data=bytes([7, 8]))], channels=[1, 5])

        self.assertEqual(samples[0][1:], [7, 0])


class CliTests(unittest.TestCase):
    def test_capture_writes_the_samples_to_a_json_file(self):
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
        probe.close()

        def send():
            sender = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            for level in range(20):
                sender.sendto(artdmx_packet(universe=0, data=bytes([level, 0])), ("127.0.0.1", port))
                time.sleep(0.02)
            sender.close()

        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "capture.json"
            threading.Timer(0.1, send).start()
            out = []
            code = main(["capture", "--bind", "127.0.0.1", "--port", str(port), "--channels", "1", "--seconds", "0.8", "--out", str(path)], out=out.append)
            data = json.loads(path.read_text())

        self.assertEqual(code, 0)
        self.assertEqual((data["universe"], data["channels"]), (0, [1]))
        self.assertGreater(len(data["samples"]), 10)
        self.assertEqual([s[1] for s in data["samples"]], sorted(s[1] for s in data["samples"]))
        self.assertIn("packets from universe 0", out[0])

    def test_analyze_prints_cycle_and_phases_from_a_capture_file(self):
        text = run_analyze(synthetic(lopsided, period=2.0, lags=[0, 0.125], seconds=16), channels=[1, 2])

        self.assertIn("cycle", text)
        self.assertRegex(text, r"ch\s*2 .*-4[4-6]\.\d")
        self.assertNotIn("-0.0", text)
        self.assertNotIn("warning", text)

    def test_analyze_warns_when_the_capture_holds_few_cycles(self):
        text = run_analyze(synthetic(lopsided, period=2.0, lags=[0], seconds=5), channels=[1])

        self.assertIn("warning", text)

    def test_analyze_marks_a_channel_outside_the_effect(self):
        samples = [row + [128] for row in synthetic(lopsided, period=2.0, lags=[0], seconds=16)]

        self.assertRegex(run_analyze(samples, channels=[1, 9]), r"ch\s*9 .*no cycle")


if __name__ == "__main__":
    unittest.main()
