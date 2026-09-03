# QQQ Short-Term Call Selection and Risk Analysis

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

[View the interactive project report](https://landerosr.github.io/qqq-options-risk-analysis/)

## Project files

- `qqq_options_analysis.py`: pricing, simulation, risk, and report generation
- `BLACK_SCHOLES_ASSUMPTIONS.md`: assumptions and model limitations
- `docs/index.html`: GitHub Pages version of the visual report
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
