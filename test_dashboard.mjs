import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  price,
  greeks,
  simulate,
  analyze,
  sampleRows,
  validate,
  parseCSV,
  cdf,
} from "./web/model.mjs";
const p = {
  symbol: "QQQ",
  spot: 706,
  target: 709,
  horizon: 1,
  budget: 1500,
  vol: 0.25,
  mu: 0,
  rate: 0.04,
  dividend: 0,
  ivShift: 0,
  fees: 1.3,
  paths: 20000,
  asof: Date.parse("2026-09-03T14:00:00Z"),
};
const rows = sampleRows(p),
  close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`);
test("BSM agrees with standard independent benchmark", () =>
  close(price(100, 100, 1, 0.2, 0.05, 0), 10.450583572185565, 1e-5));
test("expiry value and zero-volatility discounted intrinsic", () => {
  assert.equal(price(99, 100, 0, 0.2), 0);
  assert.equal(price(103, 100, 0, 0.2), 3);
  close(price(100, 100, 1, 0, 0.05, 0), 100 - 100 * Math.exp(-0.05));
});
test("call bounds, volatility monotonicity and dividend effect", () => {
  for (const s of [1, 100, 706, 10000])
    for (const k of [1, 100, 709, 10000]) {
      const v = price(s, k, 0.5, 0.25, 0.04, 0.01);
      assert.ok(v >= 0 && v <= s + 1e-6);
    }
  assert.ok(price(100, 100, 1, 0.3, 0.04) > price(100, 100, 1, 0.2, 0.04));
  assert.ok(price(100, 100, 1, 0.2, 0.04, 0.03) < price(100, 100, 1, 0.2, 0.04, 0));
});
test("Greeks agree with finite differences and theta units", () => {
  const s = 706,
    k = 709,
    t = 5 / 365,
    v = 0.25,
    r = 0.04,
    q = 0.01,
    g = greeks(s, k, t, v, r, q),
    eps = 0.001;
  close(g.delta, (price(s + eps, k, t, v, r, q) - price(s - eps, k, t, v, r, q)) / (2 * eps), 1e-4);
  close(
    g.theta,
    (price(s, k, t - eps / 365, v, r, q) - price(s, k, t + eps / 365, v, r, q)) / (2 * eps),
    1e-3,
  );
});
test("input validation rejects unsafe or nonsensical inputs", () => {
  for (const patch of [
    { spot: NaN },
    { vol: -1 },
    { paths: 1 },
    { asof: Date.now() + 3600000 },
    { symbol: "<script>" },
    { horizon: 0 },
  ])
    assert.throws(() => validate({ ...p, ...patch }, rows));
  for (const patch of [{ ask: 0 }, { bid: 10000 }, { iv: NaN }, { expiry: p.asof }, { strike: -1 }])
    assert.throws(() => validate(p, [{ ...rows[0], ...patch }]));
  assert.throws(() => validate({ ...p, horizon: 2 }, rows));
  assert.throws(() => validate(p, [rows[0], rows[0]]));
});
test("deterministic unchanged price has exact touch and terminal outcomes", () => {
  const r = simulate({ ...p, vol: 0, target: p.spot });
  assert.equal(r.touch, 1);
  assert.equal(r.finish, 1);
  assert.equal(r.terminal[0], p.spot);
  const unreachable = simulate({ ...p, vol: 0 });
  assert.equal(unreachable.touch, 0);
  assert.equal(unreachable.finish, 0);
});
test("simulation is reproducible and terminal moments match GBM", () => {
  const a = simulate(p),
    b = simulate(p);
  assert.deepEqual(a.terminal, b.terminal);
  assert.equal(a.touch, b.touch);
  const mean = a.terminal.reduce((x, y) => x + y) / p.paths;
  close(mean, p.spot * Math.exp((p.mu * p.horizon) / 365), 0.35);
  assert.ok(a.touch >= a.finish);
  assert.ok(a.touch > 0 && a.touch < 1);
});
test("Brownian bridge target touch agrees with continuous barrier formula", () => {
  const r = simulate(p),
    t = p.horizon / 365,
    a = Math.log(p.target / p.spot),
    m = p.mu - 0.5 * p.vol * p.vol,
    z = p.vol * Math.sqrt(t);
  const expected =
    cdf((m * t - a) / z) + Math.exp((2 * m * a) / (p.vol * p.vol)) * cdf((-m * t - a) / z);
  close(r.touch, expected, 0.015);
});
test("downward barrier touch includes terminal downward moves", () => {
  const r = simulate({ ...p, target: 700 });
  assert.ok(r.touch >= r.finish);
  assert.ok(r.touch > 0 && r.touch < 1);
});
test("risk-neutral Monte Carlo terminal call price agrees with BSM", () => {
  const r = simulate({ ...p, mu: p.rate - p.dividend }),
    payoffs = Array.from(r.terminal, (s) => Math.max(0, s - 709) * Math.exp(-p.rate / 365)),
    mean = payoffs.reduce((a, b) => a + b) / p.paths,
    se = Math.sqrt(payoffs.reduce((a, b) => a + (b - mean) ** 2, 0) / (p.paths - 1) / p.paths);
  close(mean, price(p.spot, 709, 1 / 365, p.vol, p.rate, p.dividend), 4 * se);
});
test("analysis respects maximum loss, VaR ordering and fee-inclusive breakeven", () => {
  const r = analyze(p, rows);
  for (const c of r.contracts) {
    close(c.cost, c.ask * 100 + p.fees);
    close(c.breakeven, c.strike + c.cost / 100);
    assert.ok(c.cvar95 >= c.var95);
    assert.ok(c.cvar95 <= c.cost + 1e-6);
    assert.ok(c.targetPnl >= -c.cost);
    assert.ok(c.pop >= 0 && c.pop <= 1);
    assert.ok(c.expiryPop >= 0 && c.expiryPop <= 1);
    close(c.ratio, c.targetPnl / c.cost);
  }
});
test("target at strike has full loss at expiry", () => {
  const c = { ...rows[1], strike: p.target };
  const r = analyze(p, [c]).contracts[0];
  close(r.targetPnl, -r.cost);
});
test("target P&L matches unchanged-IV stress test", () => {
  const c = analyze(p, [rows[3]]).contracts[0],
    target = c.stress.find((x) => x.s === p.target);
  close(c.targetPnl, target.values[1]);
});
const csv =
  "symbol,spot,quote_time,expiry,strike,bid,ask,iv_pct\nQQQ,706,2026-09-03T14:00:00Z,2026-09-08T14:00:00Z,709,5,5.2,25";
test("CSV imports dates and percent units including quoted CRLF fields", () => {
  const d = parseCSV(csv.replaceAll("\n", "\r\n").replace("QQQ", '"QQQ"'));
  assert.equal(d.symbol, "QQQ");
  assert.equal(d.rows[0].iv, 0.25);
  assert.equal(d.asof, p.asof);
  validate({ ...p, ...d }, d.rows);
});
test("CSV rejects inconsistent, missing, oversized or malformed rows", () => {
  assert.throws(() => parseCSV("x".repeat(100001)));
  assert.throws(() => parseCSV(csv.replace(",5.2,", ",,")));
  assert.throws(() =>
    parseCSV(csv + "\nAAPL,706,2026-09-03T14:00:00Z,2026-09-08T14:00:00Z,710,5,5.2,25"),
  );
  assert.throws(() => parseCSV(csv.replace("14:00:00Z", "14:00:00")));
  assert.throws(() => parseCSV(csv + '"'));
});
test("build preserves report and publishes exact tested modules", async () => {
  for (const name of ["index.html", "app.mjs", "model.mjs", "worker.mjs", "style.css"])
    assert.equal(await readFile("web/" + name, "utf8"), await readFile("docs/" + name, "utf8"));
  assert.match(await readFile("docs/report.html", "utf8"), /QQQ/);
  const html = await readFile("web/index.html", "utf8");
  for (const name of ["style.css", "app.mjs", "report.html"]) assert.ok(html.includes(name));
  assert.match(html, /No live feed/);
});
