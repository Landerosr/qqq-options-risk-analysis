# Black-Scholes assumptions and practical limitations

## Assumptions

1. The underlying price follows geometric Brownian motion and is lognormally
   distributed.
2. Volatility is known and remains constant through the option's life.
3. The risk-free interest rate is known and constant.
4. Markets are frictionless: no transaction costs, taxes, or liquidity limits.
5. Trading and hedging can occur continuously.
6. There are no arbitrage opportunities.
7. The European option can be exercised only at expiration.
8. The base model assumes no dividends. Black-Scholes-Merton can extend the
   model using a known continuous dividend yield.

## Why real QQQ options may differ

- Implied volatility varies by strike and expiration, producing a volatility
  smile or skew.
- QQQ makes distributions, so a zero-dividend assumption is simplified.
- Bid-ask spreads, execution costs, and discrete hedging affect results.
- Returns can have jumps and heavier tails than a normal distribution.
- Interest rates and volatility change over time.

The model is therefore a benchmark, not a perfect description of observed
option prices.
