export const YEAR = 365 * 86400000;
export function cdf(x) {
  const a = Math.abs(x),
    t = 1 / (1 + 0.2316419 * a);
  const tail =
    (Math.exp((-a * a) / 2) / Math.sqrt(2 * Math.PI)) *
    t *
    (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - tail : tail;
}
export function price(s, k, t, v, r = 0, q = 0) {
  if (t <= 0) return Math.max(s - k, 0);
  if (v <= 0) return Math.max(s * Math.exp(-q * t) - k * Math.exp(-r * t), 0);
  const d1 = (Math.log(s / k) + (r - q + 0.5 * v * v) * t) / (v * Math.sqrt(t));
  return Math.max(
    0,
    s * Math.exp(-q * t) * cdf(d1) - k * Math.exp(-r * t) * cdf(d1 - v * Math.sqrt(t)),
  );
}
export function greeks(s, k, t, v, r, q) {
  if (t <= 0 || v <= 0) return { delta: null, theta: null };
  const d1 = (Math.log(s / k) + (r - q + 0.5 * v * v) * t) / (v * Math.sqrt(t)),
    d2 = d1 - v * Math.sqrt(t),
    pdf = Math.exp((-d1 * d1) / 2) / Math.sqrt(2 * Math.PI);
  return {
    delta: Math.exp(-q * t) * cdf(d1),
    theta:
      ((-s * Math.exp(-q * t) * pdf * v) / (2 * Math.sqrt(t)) -
        r * k * Math.exp(-r * t) * cdf(d2) +
        q * s * Math.exp(-q * t) * cdf(d1)) /
      365,
  };
}
export function random(seed = 42) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function normal(rng) {
  return Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng());
}
export function validate(p, rows) {
  const bounds = {
    spot: [0.01, 1e5],
    target: [0.01, 1e5],
    horizon: [0.01, 90],
    budget: [0.01, 1e7],
    vol: [0, 3],
    mu: [-1, 1],
    rate: [-0.1, 0.5],
    dividend: [0, 0.5],
    ivShift: [-1, 1],
    fees: [0, 1000],
  };
  for (const [key, [low, high]] of Object.entries(bounds))
    if (!Number.isFinite(p[key]) || p[key] < low || p[key] > high)
      throw Error(`Check ${key}: expected ${low} to ${high}.`);
  if (!/^[A-Z^][A-Z0-9.^-]{0,11}$/.test(p.symbol)) throw Error("Enter a valid ticker.");
  if (![20000, 100000].includes(p.paths)) throw Error("Choose 20,000 or 100,000 paths.");
  if (!Number.isFinite(p.asof) || p.asof > Date.now() + 60000)
    throw Error("The snapshot must be a valid time, not in the future.");
  if (!rows.length || rows.length > 40) throw Error("Enter between 1 and 40 contracts.");
  const seen = new Set();
  rows.forEach((c, i) => {
    if (
      !Number.isFinite(c.strike) ||
      c.strike <= 0 ||
      c.strike > 1e5 ||
      !Number.isFinite(c.bid) ||
      !Number.isFinite(c.ask) ||
      c.bid < 0 ||
      c.ask <= 0 ||
      c.bid > c.ask ||
      c.ask > 1e5 ||
      !Number.isFinite(c.iv) ||
      c.iv < 0 ||
      c.iv > 3
    )
      throw Error(`Contract ${i + 1}: check strike, bid ≤ ask, and IV (0–300%).`);
    if (!Number.isFinite(c.expiry) || c.expiry <= p.asof || c.expiry - p.asof > YEAR * 3)
      throw Error(`Contract ${i + 1}: expiration must be after the snapshot and within 3 years.`);
    if (c.expiry + 1 < p.asof + p.horizon * 86400000)
      throw Error(
        `Contract ${i + 1} expires before your horizon. Shorten the horizon or remove that contract.`,
      );
    const key = `${c.strike}:${c.expiry}`;
    if (seen.has(key)) throw Error("Remove duplicate strike/expiration pairs.");
    seen.add(key);
  });
}
export function simulate(p) {
  const rng = random(),
    bridgeRng = random(314159),
    n = p.paths,
    t = p.horizon / 365,
    steps = Math.min(256, Math.max(24, Math.ceil(p.horizon * 24))),
    dt = t / steps,
    drift = (p.mu - 0.5 * p.vol * p.vol) * dt,
    scale = p.vol * Math.sqrt(dt),
    start = Math.log(p.spot),
    barrier = Math.log(p.target),
    up = p.target >= p.spot;
  const terminal = new Float64Array(n),
    samples = [];
  let hitCount = 0,
    finishCount = 0;
  for (let i = 0; i < n; i++) {
    let x = start,
      hit = p.target === p.spot;
    const path = i < 16 ? [p.spot] : null;
    for (let j = 0; j < steps; j++) {
      const next = x + drift + scale * normal(rng);
      if (!hit) {
        if (up ? next >= barrier : next <= barrier) hit = true;
        else if (scale > 0) {
          // Conditional crossing probability for a log-price Brownian bridge.
          const crossing = Math.exp((-2 * (barrier - x) * (barrier - next)) / (scale * scale));
          if (bridgeRng() < crossing) hit = true;
        }
      }
      x = next;
      if (path) path.push(p.spot * Math.exp(x - start));
    }
    terminal[i] = p.spot * Math.exp(x - start);
    if (hit) hitCount++;
    if (up ? terminal[i] >= p.target : terminal[i] <= p.target) finishCount++;
    if (path) samples.push(path);
  }
  return { terminal, samples, touch: hitCount / n, finish: finishCount / n };
}
export function analyze(p, rows) {
  validate(p, rows);
  const sim = simulate(p),
    h = p.horizon / 365;
  const contracts = rows.map((c, id) => {
    const t = (c.expiry - p.asof) / YEAR,
      remaining = Math.max(0, t - h),
      cost = c.ask * 100 + p.fees,
      exitIV = Math.max(0, c.iv + p.ivShift);
    const pnl = (s) => price(s, c.strike, remaining, exitIV, p.rate, p.dividend) * 100 - cost;
    const losses = Array.from(sim.terminal, (s) => -pnl(s)).sort((a, b) => a - b),
      tail = losses.slice(Math.floor(0.95 * losses.length));
    const threshold = c.strike + cost / 100;
    const expiryPop =
      p.vol > 0
        ? 1 -
          cdf(
            (Math.log(threshold / p.spot) - (p.mu - 0.5 * p.vol * p.vol) * t) /
              (p.vol * Math.sqrt(t)),
          )
        : +(p.spot * Math.exp(p.mu * t) > threshold);
    const targetPnl = pnl(p.target),
      g = greeks(p.spot, c.strike, t, c.iv, p.rate, p.dividend);
    return {
      ...c,
      id,
      days: t * 365,
      cost,
      targetPnl,
      ratio: targetPnl / cost,
      pop: losses.filter((l) => l < 0).length / losses.length,
      breakeven: threshold,
      expiryPop,
      delta: g.delta,
      theta: g.theta === null ? null : g.theta * 100,
      var95: Math.max(0, losses[Math.ceil(0.95 * losses.length) - 1]),
      cvar95: Math.max(0, tail[0] + tail.reduce((a, b) => a + (b - tail[0]), 0) / tail.length),
      theory: price(p.spot, c.strike, t, c.iv, p.rate, p.dividend),
      spread: (c.ask - c.bid) / c.ask,
      stress: [...new Set([p.spot * 0.95, p.spot, p.target, p.spot * 1.05])]
        .sort((a, b) => a - b)
        .map((s) => ({
          s,
          values: [-0.05, 0, 0.05].map(
            (shift) =>
              price(s, c.strike, remaining, Math.max(0, c.iv + shift), p.rate, p.dividend) * 100 -
              cost,
          ),
        })),
    };
  });
  return { touch: sim.touch, finish: sim.finish, samples: sim.samples, contracts, p };
}
export function sampleRows(p) {
  const center = Math.round(p.spot * 100) / 100,
    near = Math.round(p.spot * 1.00425 * 100) / 100,
    far = Math.round(p.spot * 1.0085 * 100) / 100;
  return [
    [center, 1],
    [near, 1],
    [center, 5],
    [near, 5],
    [far, 5],
    [near, 10],
  ].map(([strike, days]) => {
    const fair = price(p.spot, strike, days / 365, p.vol, p.rate, p.dividend),
      ask = Math.max(0.01, Math.round((fair + 0.05) * 100) / 100);
    return {
      strike,
      expiry: p.asof + days * 86400000,
      bid: Math.max(0, Math.round((fair - 0.05) * 100) / 100),
      ask,
      iv: p.vol,
    };
  });
}
export function parseCSV(text) {
  if (text.length > 100000) throw Error("CSV is too large (100 KB maximum).");
  // Quote-aware CSV state machine, including CRLF and escaped quotes.
  const records = [];
  let row = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (ch === "," || ch === "\n")) {
      row.push(cell.trim());
      cell = "";
      if (ch === "\n") {
        if (row.some(Boolean)) records.push(row);
        row = [];
      }
    } else if (ch !== "\r") cell += ch;
  }
  if (quoted) throw Error("CSV has an unclosed quote.");
  row.push(cell.trim());
  if (row.some(Boolean)) records.push(row);
  const header = records.shift()?.map((s) => s.replace(/^\uFEFF/, "").toLowerCase());
  const required = ["symbol", "spot", "quote_time", "expiry", "strike", "bid", "ask", "iv_pct"];
  if (
    !header ||
    required.some((k) => !header.includes(k)) ||
    new Set(header).size !== header.length
  )
    throw Error("CSV needs unique columns: " + required.join(", "));
  if (!records.length || records.length > 40) throw Error("CSV needs 1–40 contracts.");
  let symbol, spot, asof;
  const rows = records.map((r, i) => {
    if (r.length !== header.length) throw Error(`CSV row ${i + 2} has the wrong number of fields.`);
    const d = Object.fromEntries(header.map((k, j) => [k, r[j]]));
    if (required.some((k) => !d[k])) throw Error(`CSV row ${i + 2} has a missing value.`);
    if (
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?Z$/.test(d.quote_time) ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d(\.\d+)?)?Z$/.test(d.expiry)
    )
      throw Error("Use ISO UTC times, for example 2026-09-03T14:00:00Z.");
    if (i === 0) {
      symbol = d.symbol.toUpperCase();
      spot = Number(d.spot);
      asof = Date.parse(d.quote_time);
    } else if (
      symbol !== d.symbol.toUpperCase() ||
      spot !== Number(d.spot) ||
      asof !== Date.parse(d.quote_time)
    )
      throw Error("All rows must use the same ticker, spot and quote_time.");
    return {
      strike: Number(d.strike),
      expiry: Date.parse(d.expiry),
      bid: Number(d.bid),
      ask: Number(d.ask),
      iv: Number(d.iv_pct) / 100,
    };
  });
  return { symbol, spot, asof, rows };
}
