"""QQQ short-term call selection and risk analysis.

This educational project studies a market case based on independent trading
research: QQQ near $706 with a $709 short-term price target. It compares standard listed
call-option candidates across strikes and expirations using Black-Scholes,
Monte Carlo simulation, Greeks, target scenarios, VaR, and stress testing.

The inputs are illustrative. They are not a record of an executed trade and the
analysis is not investment advice.
"""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass
from html import escape
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"
DOCS = ROOT / "docs"
DIST = ROOT / "dist"
RESULTS.mkdir(parents=True, exist_ok=True)
DOCS.mkdir(parents=True, exist_ok=True)


@dataclass(frozen=True)
class MarketCase:
    spot: float = 706.0
    target: float = 709.0
    risk_free_rate: float = 0.04
    volatility: float = 0.25
    dividend_yield: float = 0.0
    expected_annual_return: float = 0.08
    trading_days: int = 252
    intraday_steps: int = 78
    simulations: int = 100_000
    contract_multiplier: int = 100
    random_seed: int = 42


@dataclass(frozen=True)
class CallCandidate:
    name: str
    strike: float
    days_to_expiration: int


CASE = MarketCase()
CANDIDATES = (
    CallCandidate("ATM call — 1 day", 706.0, 1),
    CallCandidate("Target-strike call — 1 day", 709.0, 1),
    CallCandidate("ATM call — 5 days", 706.0, 5),
    CallCandidate("Target-strike call — 5 days", 709.0, 5),
    CallCandidate("Higher-OTM call — 5 days", 712.0, 5),
    CallCandidate("Target-strike call — 10 days", 709.0, 10),
)
SELECTED_CANDIDATE = CANDIDATES[3]


def normal_cdf(value: float | np.ndarray) -> float | np.ndarray:
    """Standard normal cumulative distribution function."""
    if isinstance(value, np.ndarray):
        erf_values = np.vectorize(math.erf)(value / math.sqrt(2.0))
        return 0.5 * (1.0 + erf_values)
    return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))


def normal_pdf(value: float) -> float:
    """Standard normal probability density function."""
    return math.exp(-0.5 * value * value) / math.sqrt(2.0 * math.pi)


def year_fraction(days: int) -> float:
    return max(days, 0) / CASE.trading_days


def d1_d2(
    spot: float,
    strike: float,
    maturity: float,
    volatility: float = CASE.volatility,
) -> tuple[float, float]:
    if spot <= 0 or strike <= 0:
        raise ValueError("Spot and strike must be positive.")
    if volatility <= 0 or maturity <= 0:
        raise ValueError("Volatility and maturity must be positive.")
    d1 = (
        math.log(spot / strike)
        + (
            CASE.risk_free_rate
            - CASE.dividend_yield
            + 0.5 * volatility**2
        )
        * maturity
    ) / (volatility * math.sqrt(maturity))
    return d1, d1 - volatility * math.sqrt(maturity)


def black_scholes_price(
    spot: float,
    strike: float,
    maturity: float,
    option_type: str = "call",
    volatility: float = CASE.volatility,
) -> float:
    """Black-Scholes-Merton benchmark for a European call or put."""
    if maturity <= 0:
        if option_type == "call":
            return max(spot - strike, 0.0)
        if option_type == "put":
            return max(strike - spot, 0.0)
        raise ValueError("option_type must be 'call' or 'put'.")
    d1, d2 = d1_d2(spot, strike, maturity, volatility)
    discounted_spot = spot * math.exp(-CASE.dividend_yield * maturity)
    discounted_strike = strike * math.exp(-CASE.risk_free_rate * maturity)
    if option_type == "call":
        return discounted_spot * normal_cdf(d1) - discounted_strike * normal_cdf(d2)
    if option_type == "put":
        return discounted_strike * normal_cdf(-d2) - discounted_spot * normal_cdf(-d1)
    raise ValueError("option_type must be 'call' or 'put'.")


def option_greeks(strike: float, days_to_expiration: int) -> dict[str, float]:
    """Return call Greeks; Vega and Rho are per one percentage point."""
    maturity = year_fraction(days_to_expiration)
    d1, d2 = d1_d2(CASE.spot, strike, maturity)
    dividend_discount = math.exp(-CASE.dividend_yield * maturity)
    rate_discount = math.exp(-CASE.risk_free_rate * maturity)
    pdf_d1 = normal_pdf(d1)
    delta = dividend_discount * normal_cdf(d1)
    gamma = dividend_discount * pdf_d1 / (
        CASE.spot * CASE.volatility * math.sqrt(maturity)
    )
    vega = (
        CASE.spot
        * dividend_discount
        * pdf_d1
        * math.sqrt(maturity)
        / 100.0
    )
    theta_annual = (
        -CASE.spot
        * dividend_discount
        * pdf_d1
        * CASE.volatility
        / (2.0 * math.sqrt(maturity))
        - CASE.risk_free_rate
        * strike
        * rate_discount
        * normal_cdf(d2)
        + CASE.dividend_yield
        * CASE.spot
        * dividend_discount
        * normal_cdf(d1)
    )
    rho = strike * maturity * rate_discount * normal_cdf(d2) / 100.0
    return {
        "Delta": delta,
        "Gamma": gamma,
        "Vega (per 1 vol point)": vega,
        "Theta (per trading day)": theta_annual / CASE.trading_days,
        "Rho (per 1 rate point)": rho,
    }


def reprice_call(
    spot: np.ndarray | float,
    strike: float,
    maturity: float,
    volatility: np.ndarray | float,
) -> np.ndarray:
    """Vectorized call repricing used for scenario and risk calculations."""
    spot_array = np.asarray(spot, dtype=float)
    volatility_array = np.asarray(volatility, dtype=float)
    if maturity <= 0:
        return np.maximum(spot_array - strike, 0.0)
    d1 = (
        np.log(spot_array / strike)
        + (
            CASE.risk_free_rate
            - CASE.dividend_yield
            + 0.5 * volatility_array**2
        )
        * maturity
    ) / (volatility_array * math.sqrt(maturity))
    d2 = d1 - volatility_array * math.sqrt(maturity)
    return (
        spot_array
        * math.exp(-CASE.dividend_yield * maturity)
        * normal_cdf(d1)
        - strike
        * math.exp(-CASE.risk_free_rate * maturity)
        * normal_cdf(d2)
    )


def strategy_comparison() -> list[dict[str, float | str]]:
    """Compare premium, Greeks, breakeven, and a one-day target scenario."""
    rows: list[dict[str, float | str]] = []
    for candidate in CANDIDATES:
        maturity = year_fraction(candidate.days_to_expiration)
        premium = black_scholes_price(CASE.spot, candidate.strike, maturity)
        remaining_days = max(candidate.days_to_expiration - 1, 0)
        target_value = float(reprice_call(
            CASE.target,
            candidate.strike,
            year_fraction(remaining_days),
            CASE.volatility,
        ))
        target_pnl = (target_value - premium) * CASE.contract_multiplier
        greeks = option_greeks(candidate.strike, candidate.days_to_expiration)
        rows.append({
            "Candidate": candidate.name,
            "Strike": candidate.strike,
            "DTE": candidate.days_to_expiration,
            "Estimated Premium": premium,
            "Contract Cost": premium * CASE.contract_multiplier,
            "Expiration Breakeven": candidate.strike + premium,
            "Delta": greeks["Delta"],
            "Theta / Trading Day": greeks["Theta (per trading day)"],
            "Value at $709 After 1 Day": target_value,
            "Target-Scenario P&L": target_pnl,
            "Target-Scenario Return": target_pnl / (premium * CASE.contract_multiplier),
        })
    return rows


def simulate_market_paths(
    simulations: int = CASE.simulations,
    max_days: int = 10,
    seed: int = CASE.random_seed,
) -> tuple[dict[int, np.ndarray], dict[int, np.ndarray]]:
    """Simulate five-minute QQQ paths under an explicitly assumed process."""
    checkpoints = tuple(day for day in (1, 5, 10) if day <= max_days)
    terminal_parts = {day: [] for day in checkpoints}
    hit_parts = {day: [] for day in checkpoints}
    total_steps = max_days * CASE.intraday_steps
    dt = 1.0 / (CASE.trading_days * CASE.intraday_steps)
    drift = (CASE.expected_annual_return - 0.5 * CASE.volatility**2) * dt
    diffusion = CASE.volatility * math.sqrt(dt)
    rng = np.random.default_rng(seed)
    batch_size = 5_000

    for start in range(0, simulations, batch_size):
        batch = min(batch_size, simulations - start)
        paths = rng.standard_normal((batch, total_steps))
        paths *= diffusion
        paths += drift
        np.cumsum(paths, axis=1, out=paths)
        np.exp(paths, out=paths)
        paths *= CASE.spot
        for day in checkpoints:
            end = day * CASE.intraday_steps
            terminal_parts[day].append(paths[:, end - 1].copy())
            hit_parts[day].append(np.max(paths[:, :end], axis=1) >= CASE.target)

    terminal = {day: np.concatenate(parts) for day, parts in terminal_parts.items()}
    target_hit = {day: np.concatenate(parts) for day, parts in hit_parts.items()}
    return terminal, target_hit


def target_probability_rows(
    terminal: dict[int, np.ndarray],
    target_hit: dict[int, np.ndarray],
) -> list[dict[str, float]]:
    rows = []
    for day in sorted(terminal):
        prices = terminal[day]
        rows.append({
            "Trading-Day Horizon": day,
            "Probability Target Touched": float(target_hit[day].mean()),
            "Probability Finished at/above Target": float((prices >= CASE.target).mean()),
            "5th Percentile QQQ": float(np.quantile(prices, 0.05)),
            "Median QQQ": float(np.median(prices)),
            "95th Percentile QQQ": float(np.quantile(prices, 0.95)),
        })
    return rows


def monte_carlo_validation() -> list[dict[str, float | str]]:
    """Validate Monte Carlo prices for standard calls against Black-Scholes."""
    rows: list[dict[str, float | str]] = []
    for index, candidate in enumerate(CANDIDATES):
        maturity = year_fraction(candidate.days_to_expiration)
        rng = np.random.default_rng(CASE.random_seed + 1_000 + index)
        shocks = rng.standard_normal(CASE.simulations)
        terminal_spot = CASE.spot * np.exp(
            (
                CASE.risk_free_rate
                - CASE.dividend_yield
                - 0.5 * CASE.volatility**2
            )
            * maturity
            + CASE.volatility * math.sqrt(maturity) * shocks
        )
        discounted_payoff = math.exp(-CASE.risk_free_rate * maturity) * np.maximum(
            terminal_spot - candidate.strike, 0.0
        )
        mc_price = float(discounted_payoff.mean())
        standard_error = float(discounted_payoff.std(ddof=1) / math.sqrt(CASE.simulations))
        analytic = black_scholes_price(CASE.spot, candidate.strike, maturity)
        rows.append({
            "Candidate": candidate.name,
            "Black-Scholes Price": analytic,
            "Monte Carlo Price": mc_price,
            "MC Standard Error": standard_error,
            "Absolute Difference": abs(mc_price - analytic),
        })
    return rows


def risk_analysis(
    terminal: dict[int, np.ndarray],
) -> tuple[list[dict[str, float | str]], np.ndarray]:
    """Measure one-day loss risk and probability of profit at expiration."""
    rows: list[dict[str, float | str]] = []
    selected_one_day_pnl = np.array([])
    one_day_spot = terminal[1]

    for candidate in CANDIDATES:
        maturity = year_fraction(candidate.days_to_expiration)
        premium = black_scholes_price(CASE.spot, candidate.strike, maturity)
        remaining_days = max(candidate.days_to_expiration - 1, 0)
        next_value = reprice_call(
            one_day_spot,
            candidate.strike,
            year_fraction(remaining_days),
            CASE.volatility,
        )
        one_day_pnl = (next_value - premium) * CASE.contract_multiplier
        expiry_spot = terminal[candidate.days_to_expiration]
        expiry_pnl = (
            np.maximum(expiry_spot - candidate.strike, 0.0) - premium
        ) * CASE.contract_multiplier
        fifth_percentile = float(np.quantile(one_day_pnl, 0.05))
        tail = one_day_pnl[one_day_pnl <= fifth_percentile]
        rows.append({
            "Candidate": candidate.name,
            "Maximum Loss": premium * CASE.contract_multiplier,
            "One-Day VaR 95%": max(-fifth_percentile, 0.0),
            "One-Day CVaR 95%": max(-float(tail.mean()), 0.0),
            "Probability of One-Day Loss": float((one_day_pnl < 0).mean()),
            "Probability Profitable at Expiration": float((expiry_pnl > 0).mean()),
            "Expected Expiration P&L": float(expiry_pnl.mean()),
        })
        if candidate == SELECTED_CANDIDATE:
            selected_one_day_pnl = one_day_pnl
    return rows, selected_one_day_pnl


def stress_tests() -> list[dict[str, float | str]]:
    """Reprice the selected five-day $709 call after one trading day."""
    candidate = SELECTED_CANDIDATE
    premium = black_scholes_price(
        CASE.spot, candidate.strike, year_fraction(candidate.days_to_expiration)
    )
    scenarios = (
        ("Decline with volatility increase", 700.0, 0.30),
        ("No price change", 706.0, 0.25),
        ("Target reached", 709.0, 0.25),
        ("Target exceeded with volatility decline", 712.0, 0.20),
    )
    rows = []
    for name, spot, volatility in scenarios:
        value = float(reprice_call(
            spot,
            candidate.strike,
            year_fraction(candidate.days_to_expiration - 1),
            volatility,
        ))
        rows.append({
            "Scenario": name,
            "QQQ Price After 1 Day": spot,
            "Volatility": volatility,
            "Repriced Call": value,
            "Position P&L": (value - premium) * CASE.contract_multiplier,
        })
    return rows


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def html_table(rows: list[dict], formats: dict[str, str] | None = None) -> str:
    formats = formats or {}
    headers = list(rows[0].keys())
    header_html = "".join(f"<th>{escape(header)}</th>" for header in headers)
    body = []
    for row in rows:
        cells = []
        for header in headers:
            value = row[header]
            if isinstance(value, (int, float, np.integer, np.floating)):
                spec = formats.get(header, ".4f")
                text = "$" + format(float(value), spec[1:]) if spec.startswith("$") else format(float(value), spec)
            else:
                text = str(value)
            cells.append(f"<td>{escape(text)}</td>")
        body.append(f"<tr>{''.join(cells)}</tr>")
    return f"<table><thead><tr>{header_html}</tr></thead><tbody>{''.join(body)}</tbody></table>"


def svg_probability_chart(rows: list[dict[str, float]]) -> str:
    width, height = 760, 310
    left, right, top, bottom = 70, 24, 34, 58
    plot_width = width - left - right
    plot_height = height - top - bottom
    group_width = plot_width / len(rows)
    bar_width = group_width * 0.28
    parts = [f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="Target probabilities by horizon">']
    for tick in range(6):
        probability = tick / 5
        y = top + plot_height * (1 - probability)
        parts.append(f'<line x1="{left}" y1="{y:.1f}" x2="{width-right}" y2="{y:.1f}" stroke="#e5e7eb"/>')
        parts.append(f'<text x="{left-10}" y="{y+4:.1f}" text-anchor="end" font-size="11">{probability:.0%}</text>')
    for index, row in enumerate(rows):
        center = left + group_width * (index + 0.5)
        values = (
            (row["Probability Target Touched"], "#137aa5"),
            (row["Probability Finished at/above Target"], "#c55a11"),
        )
        for offset, (value, color) in enumerate(values):
            x = center + (offset - 0.5) * bar_width
            bar_height = value * plot_height
            y = top + plot_height - bar_height
            parts.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{bar_width:.1f}" height="{bar_height:.1f}" fill="{color}"/>')
        parts.append(f'<text x="{center:.1f}" y="{height-25}" text-anchor="middle" font-size="12">{int(row["Trading-Day Horizon"])} day(s)</text>')
    parts.append('<rect x="70" y="12" width="14" height="10" fill="#137aa5"/><text x="90" y="21" font-size="11">Target touched</text>')
    parts.append('<rect x="220" y="12" width="14" height="10" fill="#c55a11"/><text x="240" y="21" font-size="11">Finished at/above target</text>')
    parts.append('</svg>')
    return "".join(parts)


def svg_target_pnl_chart(rows: list[dict[str, float | str]]) -> str:
    width, height = 760, 330
    left, right, top, bottom = 70, 24, 28, 98
    values = np.array([float(row["Target-Scenario P&L"]) for row in rows])
    y_min = min(float(values.min()) * 1.15, -1.0)
    y_max = max(float(values.max()) * 1.15, 1.0)
    plot_height = height - top - bottom
    plot_width = width - left - right
    zero_y = top + y_max / (y_max - y_min) * plot_height
    bar_space = plot_width / len(rows)
    bar_width = bar_space * 0.58
    parts = [f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="Target scenario profit and loss">']
    parts.append(f'<line x1="{left}" y1="{zero_y:.1f}" x2="{width-right}" y2="{zero_y:.1f}" stroke="#4b5563"/>')
    for index, (row, value) in enumerate(zip(rows, values)):
        x = left + index * bar_space + (bar_space - bar_width) / 2
        value_y = top + (y_max - value) / (y_max - y_min) * plot_height
        y = min(value_y, zero_y)
        bar_height = abs(value_y - zero_y)
        color = "#2f855a" if value >= 0 else "#c53030"
        parts.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{bar_width:.1f}" height="{bar_height:.1f}" fill="{color}"/>')
        parts.append(f'<text x="{x+bar_width/2:.1f}" y="{height-70}" text-anchor="middle" font-size="10" transform="rotate(35 {x+bar_width/2:.1f} {height-70})">{escape(str(row["Candidate"]))}</text>')
    parts.append('</svg>')
    return "".join(parts)


def svg_pnl_histogram(pnl: np.ndarray) -> str:
    width, height = 760, 290
    left, right, top, bottom = 58, 20, 28, 48
    plot_width = width - left - right
    plot_height = height - top - bottom
    counts, edges = np.histogram(pnl, bins=40)
    max_count = max(int(counts.max()), 1)
    bar_width = plot_width / len(counts)
    parts = [f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="Selected call simulated one-day profit and loss">']
    for index, count in enumerate(counts):
        bar_height = count / max_count * plot_height
        x = left + index * bar_width
        y = top + plot_height - bar_height
        color = "#c53030" if edges[index + 1] < 0 else "#137aa5"
        parts.append(f'<rect x="{x:.1f}" y="{y:.1f}" width="{max(bar_width-1,1):.1f}" height="{bar_height:.1f}" fill="{color}"/>')
    parts.append(f'<line x1="{left}" y1="{top+plot_height}" x2="{width-right}" y2="{top+plot_height}" stroke="#4b5563"/>')
    parts.append(f'<text x="{left}" y="{height-18}" font-size="11">${edges[0]:,.0f}</text>')
    parts.append(f'<text x="{width-right}" y="{height-18}" text-anchor="end" font-size="11">${edges[-1]:,.0f}</text>')
    parts.append('</svg>')
    return "".join(parts)


def build_report(
    comparison: list[dict[str, float | str]],
    probabilities: list[dict[str, float]],
    validation: list[dict[str, float | str]],
    risk: list[dict[str, float | str]],
    selected_pnl: np.ndarray,
    stresses: list[dict[str, float | str]],
) -> None:
    selected = next(row for row in comparison if row["Candidate"] == SELECTED_CANDIDATE.name)
    selected_risk = next(row for row in risk if row["Candidate"] == SELECTED_CANDIDATE.name)
    target_change = CASE.target / CASE.spot - 1.0
    comparison_formats = {
        "Strike": "$,.0f", "DTE": ",.0f", "Estimated Premium": "$,.2f",
        "Contract Cost": "$,.0f", "Expiration Breakeven": "$,.2f",
        "Delta": ".3f", "Theta / Trading Day": "$,.3f",
        "Value at $709 After 1 Day": "$,.2f", "Target-Scenario P&L": "$,.0f",
        "Target-Scenario Return": ".1%",
    }
    probability_formats = {
        "Trading-Day Horizon": ",.0f", "Probability Target Touched": ".1%",
        "Probability Finished at/above Target": ".1%", "5th Percentile QQQ": "$,.2f",
        "Median QQQ": "$,.2f", "95th Percentile QQQ": "$,.2f",
    }
    validation_formats = {
        "Black-Scholes Price": "$,.3f", "Monte Carlo Price": "$,.3f",
        "MC Standard Error": "$,.3f", "Absolute Difference": "$,.3f",
    }
    risk_formats = {
        "Maximum Loss": "$,.0f", "One-Day VaR 95%": "$,.0f",
        "One-Day CVaR 95%": "$,.0f", "Probability of One-Day Loss": ".1%",
        "Probability Profitable at Expiration": ".1%", "Expected Expiration P&L": "$,.0f",
    }
    stress_formats = {
        "QQQ Price After 1 Day": "$,.2f", "Volatility": ".0%",
        "Repriced Call": "$,.2f", "Position P&L": "$,.0f",
    }
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QQQ Short-Term Call Selection and Risk Analysis</title>
<style>
body {{ margin:0; background:#f5f7fa; color:#17202a; font-family:Arial,sans-serif; }}
main {{ max-width:1080px; margin:0 auto; padding:34px 24px 60px; }}
h1 {{ margin-bottom:8px; }} h2 {{ margin-top:34px; }} h3 {{ margin-top:24px; }}
.subtitle {{ max-width:900px; color:#52606d; line-height:1.55; }}
.cards {{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin:24px 0; }}
.card,.panel,.insight {{ background:white; border:1px solid #dfe3e8; border-radius:9px; padding:16px; }}
.card strong {{ display:block; color:#137aa5; font-size:23px; margin-top:7px; }}
.panel {{ margin-top:14px; overflow-x:auto; }}
.insight {{ border-left:5px solid #c55a11; line-height:1.5; margin:18px 0; }}
table {{ border-collapse:collapse; width:100%; font-size:12px; }}
th,td {{ border-bottom:1px solid #e5e7eb; padding:9px; text-align:right; white-space:nowrap; }}
th:first-child,td:first-child {{ text-align:left; white-space:normal; min-width:170px; }}
th {{ background:#eef6f9; }} li {{ margin:8px 0; line-height:1.5; }}
svg {{ width:100%; height:auto; }} .note {{ font-size:12px; color:#52606d; line-height:1.5; }}
@media(max-width:760px) {{ .cards {{ grid-template-columns:repeat(2,1fr); }} }}
</style></head><body><main>
<h1>QQQ Short-Term Call Selection and Risk Analysis</h1>
<p class="subtitle">An internship-level Python project evaluating the tradeoff between low option cost, target-price probability, time decay, and downside risk for standard QQQ calls. The starting case—QQQ near $706 with a $709 target—was supplied from independent trading experience.</p>
<div class="cards">
  <div class="card">QQQ Entry Case<strong>${CASE.spot:.2f}</strong></div>
  <div class="card">QQQ Target<strong>${CASE.target:.2f} ({target_change:.2%})</strong></div>
  <div class="card">Selected Candidate<strong>$709 / 5-day call</strong></div>
  <div class="card">Estimated Contract Cost<strong>${float(selected['Contract Cost']):,.0f}</strong></div>
</div>
<p class="note">All premiums are theoretical estimates based on {CASE.volatility:.0%} volatility, a {CASE.risk_free_rate:.1%} risk-free rate, and a simplified zero-dividend assumption. They are not live quotes or brokerage records.</p>
<h2>1. Research Question</h2>
<p>When expecting a small short-term increase in QQQ, which call strike and expiration offer the best balance between premium cost, probability of profit, Theta exposure, and possible loss?</p>
<div class="insight"><strong>Important distinction:</strong> A $709 QQQ target is not automatically a profitable outcome for a $709-strike call. At expiration, the option must finish above the strike plus the premium paid to make a profit. A cheaper option can therefore have a lower probability of profit and faster percentage losses.</div>
<h2>2. Strike and Expiration Comparison</h2>
<p>Each candidate is priced at the same $706 starting point. The target scenario assumes QQQ reaches $709 after one trading day while volatility remains at 25%.</p>
<div class="panel">{html_table(comparison, comparison_formats)}</div>
<div class="panel">{svg_target_pnl_chart(comparison)}</div>
<h2>3. Monte Carlo Target Analysis</h2>
<p>The model simulates {CASE.simulations:,} QQQ paths in five-minute intervals using an 8% assumed annual return and 25% annualized volatility. “Touched” means the path reached $709 at least once; “finished” means QQQ remained at or above $709 at the horizon.</p>
<div class="panel">{svg_probability_chart(probabilities)}</div>
<div class="panel">{html_table(probabilities, probability_formats)}</div>
<h3>Monte Carlo pricing validation</h3>
<p>A separate risk-neutral simulation prices the same standard calls and checks that the estimates are reasonably close to Black-Scholes.</p>
<div class="panel">{html_table(validation, validation_formats)}</div>
<h2>4. Risk Analysis</h2>
<p>One-day VaR estimates a loss threshold under the simulated return model. Maximum loss is the premium paid. Probability of profit evaluates the contract at its expiration—not merely whether QQQ touched the target earlier.</p>
<div class="panel">{html_table(risk, risk_formats)}</div>
<h3>Selected-candidate one-day P&amp;L distribution</h3>
<p>The selected comparison candidate is the five-day $709 call. Its modeled one-day 95% VaR is <strong>${float(selected_risk['One-Day VaR 95%']):,.0f}</strong> for one contract.</p>
<div class="panel">{svg_pnl_histogram(selected_pnl)}</div>
<h2>5. Stress Tests for the Five-Day $709 Call</h2>
<div class="panel">{html_table(stresses, stress_formats)}</div>
<h2>6. Conclusion</h2>
<div class="insight"><strong>Decision insight:</strong> Under the illustrative assumptions, the original $709 target provides only a small modeled gain for the five-day $709 call compared with its potential one-day loss. The analysis therefore does not support choosing a contract only because its premium appears inexpensive. A more disciplined selection process should compare target probability, breakeven, Delta, Theta, remaining time, and downside risk before entry.</div>
<p>The project demonstrates a repeatable decision framework rather than a recommendation or proof of profitability. Its next research extension would replace assumed inputs with timestamped QQQ prices, option-chain quotes, implied volatility, bid-ask spreads, and documented exit rules for historical backtesting.</p>
<h2>Limitations</h2>
<ul>
  <li>The $706 entry and $709 target are case-study values based on an independently observed trading scenario; exact historical option quotes were not used.</li>
  <li>Black-Scholes is used as a benchmark even though listed QQQ options are American-style and QQQ makes distributions.</li>
  <li>The simulation assumes constant volatility and lognormal returns; actual intraday markets include volatility changes, jumps, spreads, liquidity constraints, and execution costs.</li>
  <li>The project evaluates a decision framework. It does not prove that a strategy is profitable without a separate historical backtest using actual option-chain data.</li>
</ul>
<p class="note">Educational analysis only. Simulated results are not investment advice or evidence of future performance.</p>
</main></body></html>"""
    for output_directory in (RESULTS, DOCS, DIST):
        output_directory.mkdir(parents=True, exist_ok=True)
    (RESULTS / "report.html").write_text(html, encoding="utf-8")
    (DOCS / "index.html").write_text(html, encoding="utf-8")
    (DIST / "index.html").write_text(html, encoding="utf-8")


def main() -> None:
    comparison = strategy_comparison()
    terminal, target_hit = simulate_market_paths()
    probabilities = target_probability_rows(terminal, target_hit)
    validation = monte_carlo_validation()
    risk, selected_pnl = risk_analysis(terminal)
    stresses = stress_tests()

    write_csv(RESULTS / "strategy_comparison.csv", comparison)
    write_csv(RESULTS / "target_probabilities.csv", probabilities)
    write_csv(RESULTS / "monte_carlo_validation.csv", validation)
    write_csv(RESULTS / "risk_summary.csv", risk)
    write_csv(RESULTS / "stress_tests.csv", stresses)
    np.savetxt(
        RESULTS / "selected_call_one_day_pnl.csv",
        selected_pnl,
        delimiter=",",
        header="Selected Call One-Day P&L",
        comments="",
    )
    build_report(comparison, probabilities, validation, risk, selected_pnl, stresses)

    selected = next(row for row in comparison if row["Candidate"] == SELECTED_CANDIDATE.name)
    one_day = next(row for row in probabilities if row["Trading-Day Horizon"] == 1)
    selected_risk = next(row for row in risk if row["Candidate"] == SELECTED_CANDIDATE.name)
    print("QQQ Short-Term Call Selection and Risk Analysis")
    print(f"Case: QQQ ${CASE.spot:.2f} to target ${CASE.target:.2f}")
    print(f"Selected five-day $709 call estimated premium: ${float(selected['Estimated Premium']):.2f}")
    print(f"One-day simulated probability target is touched: {float(one_day['Probability Target Touched']):.1%}")
    print(f"Selected-call one-day 95% VaR: ${float(selected_risk['One-Day VaR 95%']):,.2f}")
    print(f"Report: {(RESULTS / 'report.html').resolve()}")


if __name__ == "__main__":
    main()
