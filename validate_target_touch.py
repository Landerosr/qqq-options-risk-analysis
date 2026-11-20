"""Validate upper-barrier touch risk in the fixed QQQ scenario, not against market data."""
from __future__ import annotations

import argparse
import csv
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass(frozen=True)
class Scenario:
    spot: float = 706.0
    target: float = 709.0
    annual_drift: float = 0.08
    annual_volatility: float = 0.25
    years: float = 1.0 / 252.0

    def __post_init__(self):
        if not all(map(math.isfinite, (
            self.spot, self.target, self.annual_drift, self.annual_volatility, self.years
        ))):
            raise ValueError("All scenario inputs must be finite.")
        if min(self.spot, self.target) <= 0:
            raise ValueError("Spot and target must be positive.")
        if self.annual_volatility < 0 or self.years < 0:
            raise ValueError("Volatility and horizon cannot be negative.")

    @property
    def barrier(self) -> float:
        return math.log(self.target) - math.log(self.spot)

    @property
    def log_drift(self) -> float:
        return self.annual_drift - 0.5 * self.annual_volatility**2


def _cdf(z: float) -> float:
    return 0.5 * math.erfc(-z / math.sqrt(2.0))


def _mills_ratio(z: float) -> float:
    """Return Phi(-z)/phi(z) for positive z, avoiding normal-tail underflow."""
    if z <= 26:
        return _cdf(-z) * math.sqrt(2 * math.pi) * math.exp(z * z / 2)
    inv_square = (1 / z) ** 2
    term, total = 1.0, 1.0
    for i in range(1, 9):
        term *= -(2 * i - 1) * inv_square
        total += term
    return total / z


def exact_probabilities(scenario: Scenario) -> tuple[float, float]:
    """P(touch at or before horizon), P(finish at or above target), under GBM."""
    s = scenario
    b, m, t, v = s.barrier, s.log_drift, s.years, s.annual_volatility
    if t == 0 or v == 0:
        endpoint = m * t
        return float(max(0.0, endpoint) >= b), float(endpoint >= b)
    scale = v * math.sqrt(t)
    z = (m * t - b) / scale
    finish = _cdf(z)
    if b <= 0:
        return 1.0, finish
    # Reflection principle with drift: add exp(2*m*b/v^2)*Phi(-w).
    # When w is positive, completing the square gives phi(z)*Mills(w).
    w = (m * t + b) / scale
    if w > 1:
        reflected = math.exp(-0.5 * z * z) / math.sqrt(2 * math.pi) * _mills_ratio(w)
    else:
        reflected = math.exp(2 * (m * t / scale) * (b / scale)) * _cdf(-w)
    return min(1.0, finish + reflected), finish


def simulate(scenario: Scenario, paths: int, steps: int, seed: int) -> dict[str, float]:
    """Estimate on independent paths; within a path all methods share grid draws."""
    if paths < 2 or steps < 1:
        raise ValueError("At least two paths and one step are required.")
    s = scenario
    b, m, t, v = s.barrier, s.log_drift, s.years, s.annual_volatility
    exact_touch, exact_finish = exact_probabilities(s)
    if t == 0 or v == 0:
        return _summary(
            np.full(paths, exact_touch), np.full(paths, exact_touch), np.full(paths, exact_finish)
        )
    dt = t / steps
    variance = v**2 * dt
    rng = np.random.Generator(np.random.PCG64(seed))
    x = np.zeros(paths)
    hit_grid = np.full(paths, b <= 0)
    log_survival = np.zeros(paths)
    for _ in range(steps):
        y = x + m * dt + math.sqrt(variance) * rng.standard_normal(paths)
        hit_grid |= y >= b
        alive = ~hit_grid
        # On below-barrier endpoints, P(no crossing | endpoints) = 1 - exp(-2*d0*d1/variance).
        exponent = -2.0 * (b - x[alive]) * (b - y[alive]) / variance
        with np.errstate(divide="ignore"):
            log_survival[alive] += np.log(-np.expm1(exponent))
        x = y
    # Integrate over conditional crossings instead of drawing another random indicator.
    hit_bridge = np.where(hit_grid, 1.0, -np.expm1(log_survival))
    return _summary(hit_grid.astype(float), hit_bridge, (x >= b).astype(float))


def _summary(grid: np.ndarray, bridge: np.ndarray, finish: np.ndarray) -> dict[str, float]:
    metrics = {}
    for name, values in (
        ("grid_touch", grid),
        ("bridge_touch", bridge),
        ("finish", finish),
        ("bridge_minus_grid", bridge - grid),
    ):
        metrics[name] = float(np.mean(values))
        metrics[f"{name}_se"] = float(np.std(values, ddof=1) / math.sqrt(values.size))
    return metrics


def run_study(paths: int = 100_000, seed: int = 42) -> list[dict[str, int | float]]:
    """Return probabilities and Monte Carlo standard errors as fractions (0–1)."""
    rows = []
    rng = np.random.SeedSequence(seed)
    settings = [(v, steps) for v in (0.15, 0.25, 0.40) for steps in (1, 13, 78)]
    for (volatility, steps), child in zip(settings, rng.spawn(len(settings))):
        scenario = Scenario(annual_volatility=volatility)
        touch, finish = exact_probabilities(scenario)
        rows.append(dict(
            spot=scenario.spot, target=scenario.target, annual_drift=scenario.annual_drift,
            annual_volatility=volatility, horizon_years=scenario.years, steps=steps,
            paths=paths, root_seed=seed, exact_touch=touch, exact_finish=finish,
            **simulate(scenario, paths, steps, child),
        ))
    return rows


def render_report(rows: list[dict[str, int | float]], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    fields = list(rows[0])
    with destination.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fields, lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: f"{v:.10f}" if isinstance(v, float) else v for k, v in row.items()})


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--paths", type=int, default=100_000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent / "results" / "target_touch_validation.csv")
    args = parser.parse_args()
    if args.paths < 2 or args.seed < 0:
        parser.error("Use at least two paths and a nonnegative seed.")
    render_report(run_study(args.paths, args.seed), args.output)


if __name__ == "__main__":
    main()
