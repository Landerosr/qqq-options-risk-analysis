import math
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from validate_target_touch import Scenario, exact_probabilities, render_report, run_study, simulate


class TargetTouchValidationTests(unittest.TestCase):
    def test_zero_log_drift_reflection_gives_twice_terminal_tail(self):
        scenario = Scenario(annual_drift=0.5 * 0.25**2)
        touch, finish = exact_probabilities(scenario)
        self.assertAlmostEqual(touch, 2.0 * finish, places=14)

    def test_fixed_scenario_agrees_with_direct_reflection_expression(self):
        scenario = Scenario()
        b = math.log(709 / 706)
        m = 0.08 - 0.25**2 / 2
        t = 1 / 252
        cdf = lambda z: 0.5 * (1 + math.erf(z / math.sqrt(2)))
        finish = cdf((m * t - b) / (0.25 * math.sqrt(t)))
        touch = finish + math.exp(2 * m * b / 0.25**2) * cdf(
            (-m * t - b) / (0.25 * math.sqrt(t))
        )
        self.assertAlmostEqual(exact_probabilities(scenario)[0], touch, places=13)
        self.assertAlmostEqual(exact_probabilities(scenario)[1], finish, places=13)

    def test_touch_at_inception_includes_barrier_equal_to_spot(self):
        scenario = Scenario(target=706)
        exact_touch, exact_finish = exact_probabilities(scenario)
        self.assertEqual(exact_touch, 1)
        self.assertLess(exact_finish, 1)
        result = simulate(scenario, paths=500, steps=13, seed=6)
        self.assertEqual(result["grid_touch"], 1)
        self.assertEqual(result["bridge_touch"], 1)
        self.assertEqual(result["bridge_touch_se"], 0)
        self.assertEqual(result["bridge_minus_grid"], 0)

    def test_time_and_volatility_degenerate_cases(self):
        for scenario, expected in (
            (Scenario(years=0), (0, 0)),
            (Scenario(years=0, target=706), (1, 1)),
            (Scenario(annual_volatility=0, annual_drift=2), (1, 1)),
            (Scenario(annual_volatility=0, annual_drift=-2, target=706), (1, 0)),
        ):
            with self.subTest(scenario=scenario):
                self.assertEqual(exact_probabilities(scenario), expected)
                result = simulate(scenario, paths=100, steps=4, seed=7)
                self.assertEqual((result["bridge_touch"], result["finish"]), expected)
                self.assertEqual(result["bridge_touch_se"], 0)

    def test_high_positive_drift_with_tiny_volatility_has_finite_probability(self):
        scenario = Scenario(annual_volatility=0.0001, annual_drift=1.0, years=0.00424)
        touch, finish = exact_probabilities(scenario)
        self.assertTrue(0 < finish <= touch < 1)

    def test_fixes_same_path_grid_bias_with_reported_uncertainty(self):
        scenario = Scenario()
        exact_touch, exact_finish = exact_probabilities(scenario)
        for steps in (1, 13, 78):
            with self.subTest(steps=steps):
                r = simulate(scenario, paths=50_000, steps=steps, seed=19)
                self.assertTrue(0 <= r["finish"] <= r["grid_touch"] <= r["bridge_touch"] <= 1)
                self.assertLess(abs(r["bridge_touch"] - exact_touch), 4 * r["bridge_touch_se"])
                self.assertLess(abs(r["finish"] - exact_finish), 4 * r["finish_se"])
                self.assertGreater(r["bridge_minus_grid"], 4 * r["bridge_minus_grid_se"])
                self.assertAlmostEqual(r["bridge_minus_grid"], r["bridge_touch"] - r["grid_touch"])
                if steps == 1:
                    self.assertEqual(r["grid_touch"], r["finish"])

    def test_reports_same_bytes_with_same_seed(self):
        with TemporaryDirectory() as tmp:
            a, b = (Path(tmp) / name for name in ("a.csv", "b.csv"))
            render_report(run_study(paths=100, seed=5), a)
            render_report(run_study(paths=100, seed=5), b)
            self.assertEqual(a.read_bytes(), b.read_bytes())

    def test_rejects_invalid_inputs(self):
        for kwargs in (
            {"spot": 0}, {"target": -1}, {"years": -1},
            {"annual_volatility": -1}, {"annual_drift": math.nan},
        ):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                Scenario(**kwargs)
        for paths, steps in ((1, 13), (50, 0)):
            with self.subTest(paths=paths, steps=steps), self.assertRaises(ValueError):
                simulate(Scenario(), paths, steps, seed=18)


if __name__ == "__main__":
    unittest.main()
