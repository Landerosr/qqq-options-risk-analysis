import math
import unittest

import qqq_options_analysis as project


class QQQOptionsProjectTests(unittest.TestCase):
    def test_put_call_parity(self):
        maturity = project.year_fraction(5)
        strike = 709.0
        call = project.black_scholes_price(project.CASE.spot, strike, maturity, "call")
        put = project.black_scholes_price(project.CASE.spot, strike, maturity, "put")
        left = call - put
        right = (
            project.CASE.spot * math.exp(-project.CASE.dividend_yield * maturity)
            - strike * math.exp(-project.CASE.risk_free_rate * maturity)
        )
        self.assertAlmostEqual(left, right, places=9)

    def test_long_call_greeks_have_expected_signs(self):
        greeks = project.option_greeks(709.0, 5)
        self.assertGreater(greeks["Delta"], 0)
        self.assertLess(greeks["Delta"], 1)
        self.assertGreater(greeks["Gamma"], 0)
        self.assertGreater(greeks["Vega (per 1 vol point)"], 0)
        self.assertLess(greeks["Theta (per trading day)"], 0)

    def test_monte_carlo_prices_are_close_to_black_scholes(self):
        rows = project.monte_carlo_validation()
        for row in rows:
            tolerance = 4.0 * float(row["MC Standard Error"])
            self.assertLess(float(row["Absolute Difference"]), tolerance)

    def test_target_hit_probability_increases_with_horizon(self):
        terminal, hit = project.simulate_market_paths(simulations=10_000, seed=123)
        probabilities = project.target_probability_rows(terminal, hit)
        touches = [float(row["Probability Target Touched"]) for row in probabilities]
        self.assertTrue(all(later >= earlier for earlier, later in zip(touches, touches[1:])))

    def test_breakeven_and_maximum_loss_are_logical(self):
        comparison = project.strategy_comparison()
        terminal, _ = project.simulate_market_paths(simulations=10_000, seed=321)
        risk, _ = project.risk_analysis(terminal)
        for comparison_row, risk_row in zip(comparison, risk):
            self.assertGreater(comparison_row["Expiration Breakeven"], comparison_row["Strike"])
            self.assertAlmostEqual(
                risk_row["Maximum Loss"], comparison_row["Contract Cost"], places=8
            )
            self.assertGreaterEqual(risk_row["One-Day VaR 95%"], 0)
            self.assertGreaterEqual(risk_row["Probability Profitable at Expiration"], 0)
            self.assertLessEqual(risk_row["Probability Profitable at Expiration"], 1)


if __name__ == "__main__":
    unittest.main()
