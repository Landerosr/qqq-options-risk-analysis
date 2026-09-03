# Options Research — Call Selection & Risk Analysis

[Open the options dashboard →](https://landerosr.github.io/qqq-options-risk-analysis/)

An interactive extension of my QQQ research: enter a ticker, price target and
time horizon, then compare the cost, modeled outcome and downside risk of call
contracts. The original fixed-scenario Python study is preserved separately.

## Using the dashboard

1. Start with the clearly labeled synthetic QQQ example, or enter your own ticker
   and underlying price. Changing a ticker **does not fetch market data**.
2. Set the target, horizon in **calendar days**, and one-contract budget.
3. Enter bid, ask, strike, expiry and implied volatility for standard 100-share
   calls, or import a CSV using the on-page template. Use a consistent UTC snapshot.
4. Run 20,000 or 100,000 Monte Carlo paths. Compare target-touch probability,
   target P&L, horizon profit probability, expiry breakeven, Delta and Theta.
5. Select a contract for VaR, CVaR and a price/volatility stress table.

**Data boundary:** there is no automatic Yahoo feed or broker connection. The
Yahoo link opens the selected ticker's chain as a reference. Enter/import quotes
you are permitted to use. All input stays in the browser, with no account or
upload server. Entered data is not independently verified and is not retained
when the page reloads. Snapshot age and wide spreads are flagged for review.

## Model choices

- Black–Scholes–Merton reprices calls at the horizon, using each contract's IV and
  an optional exit-IV change. It is a **European-exercise approximation**, not an
  American early-exercise model. Continuous dividend yield is not a discrete
  dividend schedule.
- A common geometric Brownian motion drives all contracts, using the user's
  underlying volatility and expected **price return**. Expected return defaults
  to 0%; the target does not calibrate or imply a return forecast. The risk-free
  rate is used for pricing, not presented as a real-world return forecast.
- 365-day year fractions include overnight and weekend time. Snapshot and expiry
  are explicit UTC timestamps; the tool does not infer exchange calendars or
  expiration times. This differs from the original study's 252-trading-day clock.
- Stock paths use seed 42. An independent Brownian-bridge stream (seed 314159)
  models between-step target crossings. The displayed paths are 16 samples,
  not confidence bands. The target-touch sampling margin excludes model error.
- P&L assumes buying at the entered ask and selling at a theoretical horizon
  value, minus entered total fees. There is no stop-loss or exit-at-first-touch
  rule. Exit spreads, slippage, financing and exercise/assignment cash needs are
  not modeled. Expiry probability uses the lognormal terminal distribution.
- Reward/risk = target-scenario net profit / (100 × ask + entered fees).
  VaR is the nearest-rank 95th percentile of loss; CVaR averages the worst 5%.
  Both are floored at zero. Neither replaces the maximum-loss calculation.
- The tool rejects contracts expiring before the horizon, crossed quotes,
  inconsistent CSV snapshots, duplicate contracts and unsupported values.
  Adjusted contracts, puts, multi-leg trades and live execution are out of scope.

No performance claim or recommendation follows from a favorable modeled result.
The dashboard is a scenario-comparison tool, not a validated trading strategy.

## Build and checks

The dashboard is dependency-free HTML, CSS and JavaScript. Simulation runs in a
Web Worker so editing remains responsive. Python/NumPy power the retained study.

```sh
node build-dashboard.mjs
node --test test_dashboard.mjs
python3 -m pip install -r requirements.txt
python3 -m unittest -v test_qqq_options.py
python3 -m http.server 3000 --directory docs
```

Dashboard tests cover pricing benchmarks, numerical Greeks, deterministic cases,
GBM moments, continuous-barrier probabilities, Monte Carlo pricing, risk bounds,
CSV validation and build consistency. Serve over HTTP; opening the HTML directly
as a local file can prevent the module worker from loading.

Source: `web/`. Published output: `docs/`. Original report: `docs/report.html`.
Running the Python report generator updates `report.html`, not the dashboard.

References: [Options Industry Council: Black–Scholes](https://www.optionseducation.org/advancedconcepts/black-scholes-formula)
and [Yahoo Finance data disclosures](https://help.yahoo.com/kb/finance/article-exchanges-data-delays-sln2310.html).

---

## Original QQQ study

This Python project evaluates a practical options question:

> When expecting a small short-term increase in QQQ, which call strike and
> expiration offer the best balance between premium cost, probability of
> profit, time decay, and downside risk?

The starting case reflects independent trading research involving QQQ near
**$706** with a **$709 target**. Because exact historical option-chain quotes
were not used, the project compares six illustrative standard call candidates.
These are model inputs, not records of an executed trade.

## What the project demonstrates

1. Black-Scholes pricing and Greeks for standard QQQ calls
2. Comparison of at-the-money and out-of-the-money strikes
3. Comparison of 1-, 5-, and 10-trading-day expirations
4. Monte Carlo estimates of target-touch and target-finish probabilities
5. Monte Carlo pricing validation against Black-Scholes
6. One-day VaR, CVaR, maximum loss, and probability of profit
7. Price-and-volatility stress testing

## Main analytical insight

Reaching a price target does not automatically make a call profitable. At
expiration, QQQ must finish above the strike plus the premium paid. Lower-cost
out-of-the-money calls reduce dollars at risk, but can also have lower Delta,
lower probability of profit, and faster percentage losses.

## Illustrative findings

- The simulated probability of touching $709 within one trading day was 74.2%,
  while the probability of finishing the day at or above $709 was 40.0%.
- A one-day $709-strike call would expire worthless if QQQ finished exactly at
  $709 because the option would have no intrinsic value.
- For the five-day $709-strike comparison candidate, reaching $709 after one
  day produced an estimated $37 gain because four days of time value remained.
- The same five-day candidate had an estimated one-day 95% VaR of approximately
  $666 on an $876 theoretical contract cost.

These results depend on the assumptions and are not evidence that a trading
strategy is profitable.

## Visual report

[View the original project report](https://landerosr.github.io/qqq-options-risk-analysis/report.html)

## Project files

- `qqq_options_analysis.py`: pricing, simulation, risk, and report generation
- `BLACK_SCHOLES_ASSUMPTIONS.md`: assumptions and model limitations
- `docs/report.html`: GitHub Pages version of the original visual report
- `results/*.csv`: summary model outputs
- `test_qqq_options.py`: five automated validation checks

## Run the analysis

```bash
python3 -m pip install -r requirements.txt
python3 qqq_options_analysis.py
python3 -m unittest -v test_qqq_options.py
```

## Limitations

- Inputs use assumed volatility, interest rate, return, and dividend yield.
- Black-Scholes is a benchmark; listed QQQ options are American-style and QQQ
  makes distributions.
- Simulated lognormal returns do not fully capture jumps, volatility changes,
  liquidity, spreads, or execution costs.
- A historical options backtest would be required before making any statement
  about realized strategy performance.

Educational analysis only. This project is not investment advice.
