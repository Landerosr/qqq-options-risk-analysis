import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import {
  price,
  greeks,
  simulate,
  analyze,
  sampleRows,
  validate,
  parseCSV,
  cdf,
  YEAR,
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
test("worthless probability uses strike, not premium-inclusive break-even", () => {
  const r = analyze(p, rows);
  for (const c of r.contracts) {
    const t = c.days / 365;
    close(c.worthlessProbability, cdf((Math.log(c.strike / p.spot) - (p.mu - p.vol ** 2 / 2) * t) / (p.vol * Math.sqrt(t))));
    assert.ok(c.worthlessProbability <= 1 - c.expiryPop);
  }
});
test("zero volatility handles worthless calls including exactly at strike", () => {
  const q = { ...p, vol: 0, mu: 0 };
  const r = analyze(q, sampleRows(q));
  for (const c of r.contracts) assert.equal(c.worthlessProbability, +(q.spot <= c.strike));
});
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
test("CSV rejects impossible calendar dates instead of rolling them forward", () => {
  for (const field of ["quote_time", "expiry"]) {
    const index = field === "quote_time" ? 2 : 3;
    for (const invalid of [
      "2026-02-30T14:00:00Z",
      "2025-02-29T14:00:00Z",
      "2100-02-29T14:00:00Z",
      "2026-04-31T14:00:00Z",
      "2026-13-01T14:00:00Z",
      "2026-09-03T24:00:00Z",
      "2026-09-03T14:60:00Z",
      "2026-09-03T14:00:60Z",
    ]) {
      const values = csv.split("\n")[1].split(",");
      values[index] = invalid;
      assert.throws(
        () => parseCSV(csv.split("\n")[0] + "\n" + values.join(",")),
        new RegExp(`CSV row 2: ${field}`),
        invalid,
      );
    }
  }
});
test("CSV preserves leap days, optional seconds and fractional UTC timestamps", () => {
  const input = csv
    .replace("2026-09-03T14:00:00Z", "2024-02-29T14:00Z")
    .replace("2026-09-08T14:00:00Z", "2024-03-01T14:00:00.125Z");
  const data = parseCSV(input);
  assert.equal(new Date(data.asof).toISOString(), "2024-02-29T14:00:00.000Z");
  assert.equal(new Date(data.rows[0].expiry).toISOString(), "2024-03-01T14:00:00.125Z");
  const equivalent = input + "\nQQQ,7.06e2,2024-02-29T14:00:00.000Z,2024-03-02T14:00Z,710,5,5.2,25";
  assert.equal(parseCSV(equivalent).rows.length, 2);
});
test("CSV numeric fields reject non-decimal and non-finite values with row context", () => {
  const fields = ["symbol", "spot", "quote_time", "expiry", "strike", "bid", "ask", "iv_pct"];
  for (const field of ["spot", "strike", "bid", "ask", "iv_pct"])
    for (const invalid of ["0x10", "0b10", "0o10", "Infinity", "NaN", "1e309", "25%"] ) {
      const values = csv.split("\n")[1].split(",");
      values[fields.indexOf(field)] = invalid;
      assert.throws(
        () => parseCSV(csv + "\n" + values.join(",")),
        new RegExp(`CSV row 3: ${field}`),
      );
    }
});
test("CSV accepts ordinary decimal and scientific notation without changing units", () => {
  const data = parseCSV(csv.replace(",706,", ",7.06e2,").replace(",5,5.2,25", ",0,+5.2,2.5e1"));
  assert.equal(data.spot, 706);
  assert.equal(data.rows[0].bid, 0);
  assert.equal(data.rows[0].ask, 5.2);
  assert.equal(data.rows[0].iv, 0.25);
});
test("build preserves report and publishes exact tested modules", async () => {
  for (const name of ["index.html", "app.mjs", "model.mjs", "worker.mjs", "style.css"])
    assert.equal(await readFile("web/" + name, "utf8"), await readFile("docs/" + name, "utf8"));
  assert.match(await readFile("docs/report.html", "utf8"), /QQQ/);
  const html = await readFile("web/index.html", "utf8");
  for (const name of ["style.css", "app.mjs", "report.html"]) assert.ok(html.includes(name));
  assert.match(html, /No automatic options-data feed/);
});

test("put price matches benchmark and dividend-adjusted put-call parity", () => {
  close(price(100, 100, 1, 0.2, 0.05, 0, "put"), 5.573526022256971, 1e-5);
  for (const s of [50, 100, 200])
    for (const k of [60, 100, 180])
      for (const t of [0, 1 / 365, 0.5, 2])
        for (const v of [0, 0.2, 0.8])
          for (const r of [-0.03, 0.05]) {
            const q = 0.02;
            close(price(s, k, t, v, r, q) - price(s, k, t, v, r, q, "put"),
              s * Math.exp(-q * t) - k * Math.exp(-r * t), 1e-8);
          }
});
test("put expiry payoff and zero-volatility pricing handle ITM, ATM and OTM", () => {
  for (const s of [0, 90, 100, 110]) {
    assert.equal(price(s, 100, 0, 0.2, 0.05, 0, "put"), Math.max(100 - s, 0));
    close(price(s, 100, 0.5, 0, 0.05, 0.02, "put"),
      Math.max(100 * Math.exp(-0.05 * 0.5) - s * Math.exp(-0.02 * 0.5), 0));
  }
});
test("put prices satisfy bounds, volatility monotonicity and dividend effect", () => {
  for (const s of [1, 100, 706, 10000])
    for (const k of [1, 100, 709, 10000]) {
      const value = price(s, k, 0.5, 0.25, 0.04, 0.01, "put"),
        lower = Math.max(k * Math.exp(-0.04 * 0.5) - s * Math.exp(-0.01 * 0.5), 0);
      assert.ok(value >= lower - 1e-6 && value <= k * Math.exp(-0.04 * 0.5) + 1e-6);
    }
  assert.ok(price(100, 100, 1, 0.3, 0.04, 0, "put") > price(100, 100, 1, 0.2, 0.04, 0, "put"));
  assert.ok(price(100, 100, 1, 0.2, 0.04, 0.03, "put") > price(100, 100, 1, 0.2, 0.04, 0, "put"));
});
test("put Delta and daily Theta agree with finite differences and parity", () => {
  for (const s of [90, 100, 110]) {
    const k = 100, t = 30 / 365, v = 0.25, r = 0.04, q = 0.01, eps = 0.001;
    const g = greeks(s, k, t, v, r, q, "put"), call = greeks(s, k, t, v, r, q);
    close(g.delta, (price(s + eps, k, t, v, r, q, "put") - price(s - eps, k, t, v, r, q, "put")) / (2 * eps), 1e-4);
    close(g.theta, (price(s, k, t - eps / 365, v, r, q, "put") - price(s, k, t + eps / 365, v, r, q, "put")) / (2 * eps), 1e-4);
    assert.ok(g.delta >= -1 && g.delta <= 0);
    close(call.delta - g.delta, Math.exp(-q * t));
    close(call.theta - g.theta, (q * s * Math.exp(-q * t) - r * k * Math.exp(-r * t)) / 365);
  }
  assert.deepEqual(greeks(100, 100, 0, 0.2, 0.04, 0, "put"), { delta: null, theta: null });
  assert.deepEqual(greeks(100, 100, 1, 0, 0.04, 0, "put"), { delta: null, theta: null });
});
test("type validation preserves default calls and allows call-put strike/expiry pairs", () => {
  const call = { ...rows[0], type: "call" }, put = { ...rows[0], type: "put" };
  validate(p, [call, put]);
  assert.throws(() => validate(p, [put, put]), /duplicate/);
  const { type, ...legacy } = call;
  validate(p, [legacy]);
  assert.throws(() => validate(p, [legacy, call]), /duplicate/);
  assert.equal(analyze(p, [legacy]).contracts[0].type, "call");
  assert.equal(price(100, 100, 1, 0.2, 0.05), price(100, 100, 1, 0.2, 0.05, 0, "call"));
  for (const type of ["", "Put", "short", null, 1]) {
    assert.throws(() => validate(p, [{ ...call, type }]), /type must be call or put/);
    assert.throws(() => price(100, 100, 0, 0.2, 0, 0, type), /type must be call or put/);
    assert.throws(() => greeks(100, 100, 0, 0.2, 0, 0, type), /type must be call or put/);
  }
});
test("put analysis uses fee-inclusive breakeven, contract units and bounded loss", () => {
  const put = { ...rows[3], type: "put" }, c = analyze(p, [put]).contracts[0];
  close(c.cost, c.ask * 100 + p.fees);
  close(c.breakeven, c.strike - c.ask - p.fees / 100);
  close(c.theory, price(p.spot, c.strike, c.days / 365, c.iv, p.rate, p.dividend, "put"));
  close(c.theta, greeks(p.spot, c.strike, c.days / 365, c.iv, p.rate, p.dividend, "put").theta * 100);
  assert.ok(c.delta < 0);
  assert.ok(c.cvar95 >= c.var95 && c.cvar95 <= c.cost + 1e-6);
  assert.ok(c.targetPnl >= -c.cost);
  assert.ok(c.pop >= 0 && c.pop <= 1);
  assert.ok(c.expiryPop >= 0 && c.expiryPop <= 1);
  close(c.ratio, c.targetPnl / c.cost);
});
test("put probabilities use opposite distribution tails and strike versus breakeven", () => {
  const pair = [{ ...rows[3], type: "call" }, { ...rows[3], type: "put" }];
  const [call, put] = analyze(p, pair).contracts;
  const t = put.days / 365;
  const below = level => cdf((Math.log(level / p.spot) - (p.mu - p.vol ** 2 / 2) * t) / (p.vol * Math.sqrt(t)));
  close(put.expiryPop, below(put.breakeven));
  close(put.worthlessProbability, 1 - below(put.strike));
  close(call.worthlessProbability + put.worthlessProbability, 1);
  assert.ok(put.worthlessProbability < 1 - put.expiryPop);
});
test("deterministic put outcomes include ATM, exact breakeven and both sides", () => {
  const q = { ...p, spot: 100, target: 90, vol: 0, mu: 0, fees: 50 };
  const contract = { ...rows[0], type: "put", strike: 100, bid: 1.9, ask: 2 };
  for (const spot of [90, 97.5, 99, 100, 110]) {
    const c = analyze({ ...q, spot }, [contract]).contracts[0];
    assert.equal(c.worthlessProbability, +(spot >= contract.strike));
    assert.equal(c.expiryPop, +(spot < 97.5));
    assert.equal(c.pop, +(spot < 97.5));
  }
});
test("non-positive put breakeven never yields expiry profit or NaN", () => {
  for (const vol of [0, 0.25]) {
    const q = { ...p, spot: 100, target: 90, vol, fees: 100 };
    for (const ask of [99, 100, 101]) {
      const c = analyze(q, [{ ...rows[0], type: "put", strike: 100, bid: 0, ask }]).contracts[0];
      assert.ok(c.breakeven <= 0);
      assert.equal(c.expiryPop, 0);
      assert.ok(Number.isFinite(c.worthlessProbability));
    }
  }
});
test("expiry target scenarios and fees apply in both call and put directions", () => {
  const q = { ...p, spot: 100, target: 90, fees: 50 };
  for (const type of ["call", "put"])
    for (const target of [90, 100, 110]) {
      const c = analyze({ ...q, target }, [{ ...rows[0], type, strike: 100, bid: 1.9, ask: 2 }]).contracts[0];
      const payoff = Math.max((type === "call" ? 1 : -1) * (target - 100), 0);
      close(c.targetPnl, payoff * 100 - 250);
      close(c.stress.find(x => x.s === target).values[1], c.targetPnl);
      assert.equal(c.type, type);
    }
});
test("put target scenario and stress prices include remaining time and exit IV", () => {
  const q = { ...p, target: 700, ivShift: 0.08 }, contract = { ...rows[3], type: "put" };
  const c = analyze(q, [contract]).contracts[0], remaining = (c.days - q.horizon) / 365;
  close(c.targetPnl, price(q.target, c.strike, remaining, c.iv + q.ivShift, q.rate, q.dividend, "put") * 100 - c.cost);
  for (const row of c.stress)
    row.values.forEach((value, i) => close(value, price(row.s, c.strike, remaining, Math.max(0, c.iv + [-0.05, 0, 0.05][i]), q.rate, q.dividend, "put") * 100 - c.cost));
  assert.ok(c.stress[0].values[1] > c.stress.at(-1).values[1]);
});
test("option type does not change target-touch/finish probability or shared stock paths", () => {
  const calls = analyze({ ...p, target: 700 }, [rows[3]]);
  const puts = analyze({ ...p, target: 700 }, [{ ...rows[3], type: "put" }]);
  assert.equal(calls.touch, puts.touch);
  assert.equal(calls.finish, puts.finish);
  assert.deepEqual(calls.samples, puts.samples);
  assert.equal(calls.contracts[0].type, "call");
  assert.equal(puts.contracts[0].type, "put");
});
test("risk-neutral Monte Carlo put price agrees with BSM", () => {
  const q = { ...p, mu: p.rate - p.dividend }, r = simulate(q);
  const payoffs = Array.from(r.terminal, s => Math.max(0, 709 - s) * Math.exp(-p.rate / 365));
  const mean = payoffs.reduce((a, b) => a + b) / p.paths;
  const se = Math.sqrt(payoffs.reduce((a, b) => a + (b - mean) ** 2, 0) / (p.paths - 1) / p.paths);
  close(mean, price(p.spot, 709, 1 / 365, p.vol, p.rate, p.dividend, "put"), 4 * se);
});
test("CSV accepts explicit mixed types, defaults legacy calls and rejects ambiguous types", () => {
  assert.equal(parseCSV(csv).rows[0].type, "call");
  const lines = csv.split("\n"), mixed = `${lines[0]},type\n${lines[1]},call\n${lines[1]},PUT`;
  const data = parseCSV(mixed);
  assert.deepEqual(data.rows.map(c => c.type), ["call", "put"]);
  validate({ ...p, ...data }, data.rows);
  for (const type of ["", "c", "p", "stock", "null"])
    assert.throws(() => parseCSV(`${lines[0]},type\n${lines[1]},${type}`), /CSV row 2: type/);
});
test("dashboard labels support both contract types", async () => {
  const html = await readFile("web/index.html", "utf8"), app = await readFile("web/app.mjs", "utf8");
  assert.match(html, /<th>Type<\/th>/);
  assert.match(html, /Compare calls & puts/);
  assert.match(html, /id="worthless-label"/);
  assert.match(html, /Add contract/);
  assert.match(app, /\["call", "put"\]/);
  assert.doesNotMatch(html, /Choose your call contract|Compare calls<|Add call/);
});

test("machine-rounding residue at exact breakeven is not classified as profit", () => {
  for (const type of ["call", "put"]) {
    const spot = 100 + (type === "put" ? -1 : 1) * 2.01;
    const q = { ...p, spot, target: spot, vol: 0, mu: 0, fees: 1 };
    const c = analyze(q, [{ ...rows[0], type, strike: 100, bid: 1.9, ask: 2 }]).contracts[0];
    assert.equal(c.targetPnl, 0);
    assert.equal(c.pop, 0);
    assert.equal(c.expiryPop, 0);
    assert.equal(c.stress.find(row => row.s === spot).values[1], 0);
    // A real sub-cent profit must still be counted.
    const profitable = spot + (type === "put" ? -1 : 1) * 0.000001;
    const d = analyze({ ...q, spot: profitable }, [{ ...rows[0], type, strike: 100, bid: 1.9, ask: 2 }]).contracts[0];
    assert.equal(d.pop, 1);
    assert.equal(d.expiryPop, 1);
  }
});

// Exercise the actual row/event-handler implementation without a browser dependency.
// The optional Playwright suite covers real DOM and rendering behavior separately.
async function rowHarness(mode = "manual") {
  class Element {
    children = [];
    attributes = {};
    handlers = {};
    value = "";
    textContent = "";
    constructor(tag) { this.tag = tag; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(event, handler) { this.handlers[event] = handler; }
    fire(event) { this.handlers[event]?.({ target: this }); }
  }
  const elements = { contracts: new Element("tbody"), message: new Element("p") };
  const document = { getElementById: id => elements[id], createElement: tag => new Element(tag) };
  const source = await readFile("web/app.mjs", "utf8");
  const formatting = source.slice(source.indexOf("const $ ="), source.indexOf('\nlet mode ='));
  const render = source.slice(source.indexOf("function renderRows()"), source.indexOf("\nfunction reset()"));
  let invalidations = 0;
  const context = vm.createContext({ document, rows: structuredClone(rows), mode,
    inputs: () => ({ ...p }), price, YEAR, dirty: () => invalidations++ });
  vm.runInContext(`${formatting}\n${render}\nrenderRows();`, context);
  const all = element => [element, ...element.children.flatMap(all)];
  return { context, elements, render: () => vm.runInContext("renderRows();", context),
    invalidations: () => invalidations,
    field: (i, name) => all(elements.contracts).find(element => element.attributes["aria-label"] === `Contract ${i} ${name}`),
  };
}
test("type-selector interrupted expiry edit keeps every row and cancels stale results", async () => {
  const h = await rowHarness();
  h.field(2, "expiry UTC").value = "";
  h.field(2, "expiry UTC").fire("input");
  assert.ok(Number.isNaN(h.context.rows[1].expiry));
  for (const type of ["put", "call", "put"]) {
    h.field(2, "type").value = type;
    assert.doesNotThrow(() => h.field(2, "type").fire("change"));
    assert.equal(h.elements.contracts.children.length, 6);
    assert.equal(h.field(2, "expiry UTC").value, "");
    assert.equal(h.context.rows[1].type, type);
    for (const key of ["bid", "ask", "iv"]) {
      assert.ok(Number.isNaN(h.context.rows[1][key]));
      assert.equal(h.field(2, key).value, "");
    }
  }
  assert.equal(h.invalidations(), 4);
});
test("sample selector reprices only its explicit type and retains synthetic status", async () => {
  const h = await rowHarness("sample"), before = structuredClone(h.context.rows);
  h.field(1, "type").value = "put";
  h.field(1, "type").fire("change");
  const c = h.context.rows[0], fair = price(p.spot, c.strike, (c.expiry - p.asof) / YEAR, c.iv, p.rate, p.dividend, "put");
  assert.equal(c.type, "put");
  assert.equal(c.bid, Math.max(0, Math.round((fair - 0.05) * 100) / 100));
  assert.equal(c.ask, Math.max(0.01, Math.round((fair + 0.05) * 100) / 100));
  assert.equal(h.context.mode, "sample");
  assert.deepEqual(h.context.rows.slice(1), before.slice(1));
  assert.match(h.elements.message.textContent, /No market data was fetched/);
  h.field(1, "strike").value = "720";
  h.field(1, "strike").fire("input");
  assert.equal(h.context.rows[0].type, "put");
  h.render();
  assert.equal(h.field(1, "type").value, "put");
});
test("manual type selector preserves strike/expiry but invalidates opposite-type quote", async () => {
  const h = await rowHarness(), before = { ...h.context.rows[0] };
  h.field(1, "type").value = "put";
  h.field(1, "type").fire("change");
  assert.equal(h.context.rows[0].strike, before.strike);
  assert.equal(h.context.rows[0].expiry, before.expiry);
  for (const key of ["bid", "ask", "iv"]) assert.ok(Number.isNaN(h.context.rows[0][key]));
  assert.match(h.elements.message.textContent, /matching bid, ask and IV/);
  assert.throws(() => validate(p, h.context.rows), /check strike, bid/);
});

test("ticker edits clear sample/manual quote provenance and refresh Yahoo destination", async () => {
  const source = await readFile("web/app.mjs", "utf8");
  const formatting = source.slice(source.indexOf("const $ ="), source.indexOf('\nlet mode ='));
  const status = source.slice(source.indexOf("function status()"), source.indexOf("\nfunction dirty()"));
  const handler = source.slice(source.indexOf('$("scenario").addEventListener("input"'), source.indexOf('\n$("demo").onclick'));
  for (const mode of ["sample", "manual"]) {
    let oninput;
    const elements = {
      scenario: { addEventListener: (_, fn) => { oninput = fn; } },
      spot: { value: "706" }, asof: { value: "2026-09-03T14:00:00" },
      message: {}, "data-status": {}, yahoo: {},
    };
    let context, renders = 0, invalidations = 0;
    context = vm.createContext({ document: { getElementById: id => elements[id] },
      rows: structuredClone(rows), mode,
      inputs: () => ({ ...p, symbol: "AAPL", spot: Number(elements.spot.value), asof: Date.parse(elements.asof.value + "Z") }),
      renderRows: () => renders++, dirty: () => { invalidations++; vm.runInContext("status()", context); },
    });
    vm.runInContext(`${formatting}\n${status}\n${handler}`, context);
    oninput({ target: { id: "symbol" } });
    assert.equal(context.rows.length, 0);
    assert.equal(context.mode, "manual");
    assert.equal(elements.spot.value, "");
    assert.equal(elements.asof.value, "");
    assert.equal(elements.yahoo.href, "https://finance.yahoo.com/quote/AAPL/options/");
    assert.match(elements.message.textContent, /target and model assumptions were retained/);
    assert.equal(renders, 1);
    assert.equal(invalidations, 1);
  }
});
