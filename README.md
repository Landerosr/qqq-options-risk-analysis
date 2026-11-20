# QQQ option selection under price uncertainty

**Research question:** For a short-term move from $706 to $709 in QQQ, how do strike and maturity change a call's break-even, gain in the target scenario, and downside exposure?

The comparison uses six illustrative contracts, not historical option quotes or executed trades. The [Python study](qqq_options_analysis.py) generates the results below. A [separate scenario model](web/model.mjs) extends the analysis to manually entered calls and puts.

## Findings

- **Touching the target is not the same as closing above it.** In the one-trading-day simulation, 74.2% of sampled paths reached $709, but only 40.0% finished at or above it. Neither statistic is the probability of earning a profit on a specific contract. [Target probabilities](results/target_probabilities.csv)
- **Time remaining changes the option value at the same underlying price.** If QQQ is exactly $709 at expiry, a $709-strike call has no intrinsic value. A five-day $709-strike call repriced after one day still has four days left. At $709, its modeled gain is about $37, against an initial theoretical cost of $876 and one-day 95% VaR of about $666. That is a favorable price scenario, not a favorable risk-adjusted trade recommendation. [Contract comparison](results/strategy_comparison.csv) · [Loss metrics](results/risk_summary.csv)
- **The pricing cross-check measures numerical agreement, not predictive validity.** Across the six calls, simulated prices were within $0.024 per share of Black–Scholes–Merton values under the same assumptions. [Monte Carlo validation](results/monte_carlo_validation.csv)

## Study design

The fixed case holds spot at $706 and annual volatility at 25%, with an assumed 8% price drift, a 4% risk-free rate and no dividend yield. Strike ranges from $706 to $712 and maturity from one to ten trading days. Geometric Brownian motion generates 100,000 seeded paths on a 252-trading-day clock with 78 simulation steps per trading day. These price scenarios use the assumed drift; the separate pricing cross-check discounts risk-neutral payoffs. The study compares break-even and Greeks, uses the one-day repriced P&L distribution for probability of loss, 95% VaR and CVaR, and varies spot and volatility in a [stress grid](results/stress_tests.csv).

The [assumption notes](BLACK_SCHOLES_ASSUMPTIONS.md) explain the European pricing approximation and its limitations for listed American-style QQQ options. The input volatility and drift are not fitted; constant-volatility lognormal paths do not capture jumps or volatility regimes. A target may also be missed between observations in the fixed-step Python study. Model prices omit real execution frictions, and no historical backtest or live P&L is presented.

## Reproduce the fixed case

```sh
python3 -m pip install -r requirements.txt
python3 qqq_options_analysis.py
python3 -m unittest -v test_qqq_options.py
```

The script writes the CSVs and regenerates the [original report source](docs/report.html). [Python tests](test_qqq_options.py) check the fixed case. See the [Options Industry Council pricing reference](https://www.optionseducation.org/advancedconcepts/black-scholes-formula).

## Optional local scenario tool

The interactive model uses a 365-calendar-day clock and a default price drift of 0%, so its outputs are not interchangeable with the fixed case above. It compares calls and puts on common price paths. An independent Brownian-bridge stream estimates between-step target crossings in the scenario tool; a reported sampling margin does not capture uncertainty about the model assumptions. The calculation assumes entry at the entered ask and a theoretical exit value less user-entered fees. It does not model exit at first touch, bid–ask cost at exit, slippage, financing or exercise and assignment effects.

Start with the labeled synthetic QQQ sample or enter a consistent UTC option snapshot: ticker, underlying price, bid, ask, strike, expiry and implied volatility. Choose a target, calendar-day horizon and budget, then simulate 20,000 or 100,000 paths. Compare touch and finish probabilities, horizon P&L, expiration break-even, Greeks and tail risk. Contract type is explicit; changing ticker clears the old price, snapshot and contracts, and changing a manually entered contract's type clears its quotes and IV. The CSV importer accepts an optional `type` column and defaults legacy rows to calls.

There is no automatic option quote feed or brokerage connection. The [TradingView chart widget](https://www.tradingview.com/widget-docs/widgets/charts/advanced-chart/) is an external visual reference in Central time and does not populate the model; it receives the symbol and display settings, not the option inputs. The Yahoo chain is a reference link only ([data disclosures](https://help.yahoo.com/kb/finance/article-exchanges-data-delays-sln2310.html)). Manual inputs are in-browser, not independently verified, and not persisted on reload.

```sh
node build-dashboard.mjs
node --test test_dashboard.mjs
python3 -m http.server 3000 --directory docs
```

The [JS tests](test_dashboard.mjs) cover pricing and Greeks, put–call parity, GBM moments, barrier crossing, risk bounds, input validation and build consistency. The local build is served over HTTP so the module worker loads. A separate [browser regression suite](test_dashboard_browser.cjs) exercises the UI with external provider requests blocked:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node test_dashboard_browser.cjs
```

Set `CHROMIUM_BIN` to use an existing Chromium executable. The numerical tests do not need browser process or socket access.

Educational analysis only, not investment advice.
