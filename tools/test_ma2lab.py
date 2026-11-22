import unittest

from ma2lab import check_arg, parse_point_list, parse_showfile

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


class ArgumentTests(unittest.TestCase):
    def test_accepts_plain_form_numbers_ranges_and_names(self):
        self.assertEqual(check_arg("form", "120"), "120")
        self.assertEqual(check_arg("objects", "1 Thru 23"), "1 Thru 23")
        self.assertEqual(check_arg("name", "fh_builtin-forms"), "fh_builtin-forms")

    def test_rejects_anything_that_could_smuggle_another_command(self):
        for kind, value in [
            ("form", "1; Delete Form 1"),
            ("form", "1.2"),
            ("objects", '1 Thru 2"; NewShow'),
            ("name", 'x" ; Delete'),
            ("name", "../x"),
        ]:
            with self.subTest(kind=kind, value=value):
                with self.assertRaises(SystemExit):
                    check_arg(kind, value)


if __name__ == "__main__":
    unittest.main()
