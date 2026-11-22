import unittest

from ma2lab import parse_point_list, parse_showfile

LIST_OUTPUT = """Forms/FH Modes 101/modes 101.1 >Executing : List
               No.  X      Y      Mode
SubFormPoint 1 1    0.00   20.00  Linear
SubFormPoint 2 2    15.00  80.00  Spline
SubFormPoint 3 3    30.00  30.00  Spline (Break at Start)
SubFormPoint 6 6    75.00  70.00  Step (End)
Forms/FH Modes 101/modes 101.1 >Executing : ChangeDest /
"""


class ParseTests(unittest.TestCase):
    def test_parses_points_from_list_output(self):
        self.assertEqual(
            parse_point_list(LIST_OUTPUT),
            [
                (0.0, 20.0, "Linear"),
                (15.0, 80.0, "Spline"),
                (30.0, 30.0, "Spline (Break at Start)"),
                (75.0, 70.0, "Step (End)"),
            ],
        )

    def test_reads_showfile_name_from_version_output(self):
        text = "Console onPC 3.9.60.50\nShowfile is 'form-helper-lab'\nShowpath is 'C:/x'\n"
        self.assertEqual(parse_showfile(text), "form-helper-lab")
        self.assertIsNone(parse_showfile("nothing here"))


if __name__ == "__main__":
    unittest.main()
