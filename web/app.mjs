import { sampleRows, parseCSV, validate } from "./model.mjs";
const $ = (id) => document.getElementById(id),
  money = (n) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(n),
  pct = (n) => (100 * n).toFixed(1) + "%",
  dt = (n) => new Date(n).toISOString().slice(0, 19);
let mode = "sample",
  rows = [],
  result = null,
  worker = null,
  revision = 0;
function inputs() {
  const p = {};
  for (const id of [
    "spot",
    "target",
    "horizon",
    "budget",
    "vol",
    "mu",
    "rate",
    "dividend",
    "ivShift",
    "fees",
    "paths",
  ])
    p[id] = $(id).value === "" ? NaN : Number($(id).value);
  for (const id of ["vol", "mu", "rate", "dividend", "ivShift"]) p[id] /= 100;
  p.symbol = $("symbol").value.trim().toUpperCase();
  p.asof = Date.parse($("asof").value + "Z");
  return p;
}
function status() {
  const p = inputs(),
    age = (Date.now() - p.asof) / 3600000;
  const ageText = Number.isFinite(age)
    ? `Snapshot ${dt(p.asof).replace("T", " ")} UTC · ${Math.max(0, age).toFixed(1)} hours old.`
    : "Set a valid snapshot time.";
  $("data-status").textContent =
    mode === "sample"
      ? "SAMPLE DATA · Synthetic prices and strikes. Not live or listed contracts."
      : `${mode === "import" ? "IMPORTED" : "MANUALLY EDITED"} QUOTES · Not independently verified. ${ageText} ${age > 0.25 ? "Review stale prices before interpreting results." : ""}`;
  $("yahoo").href =
    `https://finance.yahoo.com/quote/${encodeURIComponent(p.symbol || "QQQ")}/options/`;
}
function dirty() {
  revision++;
  if (worker) {
    worker.terminate();
    worker = null;
  }
  $("run").disabled = false;
  $("run").textContent = "Run analysis ↗";
  $("results").hidden = true;
  result = null;
  $("message").textContent = "Inputs changed. Run analysis to refresh the results.";
  status();
}
function renderRows() {
  const body = $("contracts");
  body.replaceChildren();
  rows.forEach((c, i) => {
    const tr = document.createElement("tr");
    for (const [key, type, min, max, step] of [
      ["strike", "number", 0.01, 100000, "any"],
      ["expiry", "datetime-local", null, null, "1"],
      ["bid", "number", 0, 100000, "any"],
      ["ask", "number", 0.01, 100000, "any"],
      ["iv", "number", 0, 300, "any"],
    ]) {
      const td = document.createElement("td"),
        input = document.createElement("input");
      input.type = type;
      input.value = key === "expiry" ? dt(c[key]) : key === "iv" ? c[key] * 100 : c[key];
      input.setAttribute("aria-label", `Contract ${i + 1} ${key}${key === "expiry" ? " UTC" : ""}`);
      if (min !== null) input.min = min;
      if (max !== null) input.max = max;
      input.step = step;
      input.required = true;
      input.addEventListener("input", () => {
        rows[i][key] =
          key === "expiry"
            ? Date.parse(input.value + "Z")
            : input.value === ""
              ? NaN
              : Number(input.value) / (key === "iv" ? 100 : 1);
        mode = "manual";
        dirty();
      });
      td.append(input);
      tr.append(td);
    }
    const td = document.createElement("td"),
      remove = document.createElement("button");
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove contract ${i + 1}`);
    remove.onclick = () => {
      rows.splice(i, 1);
      mode = "manual";
      renderRows();
      dirty();
    };
    td.append(remove);
    tr.append(td);
    body.append(tr);
  });
}
function reset() {
  if (!$("scenario").reportValidity()) return;
  const p = inputs();
  rows = sampleRows(p);
  mode = "sample";
  renderRows();
  dirty();
  $("message").textContent =
    "Sample contracts regenerated around your underlying price. No market data was fetched.";
}
function node(tag, text, cls) {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function select(id) {
  if (!result) return;
  const c = result.contracts.find((x) => x.id === id);
  document
    .querySelectorAll(".comparison tr")
    .forEach((tr) => tr.classList.toggle("selected", Number(tr.dataset.id) === id));
  $("selected-title").textContent =
    `${result.p.symbol} $${c.strike} call · ${c.days.toFixed(2)} calendar days`;
  const risk = $("risk");
  risk.replaceChildren();
  for (const [label, value] of [
    ["Maximum loss", money(c.cost)],
    ["95% VaR · horizon", money(c.var95)],
    ["95% CVaR · horizon", money(c.cvar95)],
    ["Profit at expiration", pct(c.expiryPop)],
    ["BSM entry value / share", money(c.theory)],
    ["Entered ask / share", money(c.ask)],
    ["Spread / ask", pct(c.spread)],
    ["Exit IV at horizon", pct(Math.max(0, c.iv + result.p.ivShift))],
  ]) {
    const d = node("div", "");
    d.append(node("span", label), node("strong", value));
    risk.append(d);
  }
  const body = $("stress");
  body.replaceChildren();
  c.stress.forEach((r) => {
    const tr = node("tr", "");
    tr.append(node("td", money(r.s)));
    r.values.forEach((v) => tr.append(node("td", money(v), v >= 0 ? "positive" : "negative")));
    body.append(tr);
  });
}
function chart(r) {
  const svg = $("chart"),
    ns = "http://www.w3.org/2000/svg";
  svg.replaceChildren();
  const vals = r.samples.flat().concat(r.p.target);
  let lo = Math.min(...vals),
    hi = Math.max(...vals);
  const pad = Math.max((hi - lo) * 0.08, r.p.spot * 0.001);
  lo -= pad;
  hi += pad;
  const y = (s) => 200 - ((s - lo) / (hi - lo)) * 180;
  const add = (name, attrs) => {
    const e = document.createElementNS(ns, name);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    svg.append(e);
    return e;
  };
  for (let i = 0; i < 4; i++) {
    const value = lo + ((hi - lo) * i) / 3;
    add("line", { x1: 0, x2: 890, y1: y(value), y2: y(value), stroke: "#edf0f3" });
    add("text", { x: 900, y: y(value) + 4, fill: "#626973", "font-size": 12 }).textContent =
      value.toFixed(2);
  }
  r.samples.forEach((path) =>
    add("polyline", {
      points: path.map((s, i) => `${(i / (path.length - 1)) * 890},${y(s)}`).join(" "),
      fill: "none",
      stroke: "#165bda",
      "stroke-opacity": 0.22,
      "stroke-width": 1.4,
    }),
  );
  add("line", {
    x1: 0,
    x2: 890,
    y1: y(r.p.target),
    y2: y(r.p.target),
    stroke: "#15171c",
    "stroke-dasharray": "6 5",
    "stroke-width": 1.5,
  });
  $("chart-end").textContent = `${r.p.horizon} calendar days`;
}
function render(r) {
  result = r;
  $("results").hidden = false;
  $("touch").textContent = pct(r.touch);
  $("finish").textContent = pct(r.finish);
  $("affordable").textContent =
    `${r.contracts.filter((c) => c.cost <= r.p.budget).length} / ${r.contracts.length}`;
  $("direction").textContent =
    `At ${r.p.target >= r.p.spot ? "or above" : "or below"} ${money(r.p.target)} at the horizon`;
  $("result-label").textContent =
    `${r.p.symbol} · ${r.p.paths.toLocaleString()} paths · ${r.p.horizon} calendar days · ${mode === "sample" ? "synthetic data" : "unverified snapshot"}`;
  const body = $("comparison");
  body.replaceChildren();
  r.contracts
    .sort((a, b) => a.strike - b.strike || a.expiry - b.expiry)
    .forEach((c) => {
      const tr = node("tr", "");
      tr.dataset.id = c.id;
      const td = node("td", ""),
        b = node("button", `$${c.strike} call`);
      b.onclick = () => select(c.id);
      b.append(node("small", `${c.days.toFixed(2)}d · ${dt(c.expiry).slice(0, 10)}`));
      td.append(b);
      tr.append(td);
      const cost = node("td", money(c.cost));
      if (c.cost > r.p.budget) cost.append(node("small", "Over budget"));
      if (c.spread > 0.2) cost.append(node("small", "Wide spread (>20%)"));
      tr.append(
        cost,
        node("td", money(c.targetPnl), c.targetPnl >= 0 ? "positive" : "negative"),
        node("td", c.ratio.toFixed(2) + "×"),
        node("td", pct(c.pop)),
        node("td", money(c.breakeven)),
        node("td", c.delta === null ? "—" : c.delta.toFixed(3)),
        node("td", c.theta === null ? "—" : money(c.theta)),
      );
      body.append(tr);
    });
  chart(r);
  select(r.contracts[0].id);
  const error = 1.96 * Math.sqrt((r.touch * (1 - r.touch)) / r.p.paths);
  $("message").textContent =
    `Analysis complete. Target-touch Monte Carlo sampling margin: approximately ±${(error * 100).toFixed(2)} percentage points (95%, not model accuracy). Outcomes depend on your assumptions.`;
}
function run(event) {
  event?.preventDefault();
  if (!$("scenario").reportValidity()) return;
  try {
    const p = inputs();
    validate(p, rows);
    if (worker) worker.terminate();
    const version = ++revision;
    $("results").hidden = true;
    $("run").disabled = true;
    $("run").textContent = "Simulating…";
    $("message").textContent = "Calculating option values and simulated outcomes…";
    worker = new Worker(new URL("./worker.mjs", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      if (version !== revision) return;
      $("run").disabled = false;
      $("run").textContent = "Run analysis ↗";
      worker.terminate();
      worker = null;
      if (data.error) {
        $("message").textContent = data.error;
        return;
      }
      render(data.result);
    };
    worker.onerror = () => {
      $("run").disabled = false;
      $("run").textContent = "Run analysis ↗";
      $("message").textContent = "Simulation could not start. Refresh the website and try again.";
      worker?.terminate();
      worker = null;
    };
    worker.postMessage({ p, rows });
    status();
  } catch (e) {
    $("results").hidden = true;
    $("message").textContent = e.message;
  }
}
function importQuotes(text) {
  try {
    const data = parseCSV(text),
      p = { ...inputs(), ...data };
    delete p.rows;
    validate(p, data.rows);
    $("symbol").value = data.symbol;
    $("spot").value = data.spot;
    $("asof").value = dt(data.asof);
    rows = data.rows;
    mode = "import";
    renderRows();
    dirty();
    $("message").textContent =
      "Quotes imported. Check your price target, horizon and assumptions, then run analysis.";
  } catch (e) {
    $("message").textContent = e.message;
  }
}
$("scenario").addEventListener("submit", run);
$("scenario").addEventListener("input", (event) => {
  const id = event.target.id;
  if (id === "symbol" && mode !== "sample") {
    rows = [];
    renderRows();
    mode = "manual";
    dirty();
    $("message").textContent = "Ticker changed. Enter or import quotes for the new ticker.";
    return;
  }
  if (["spot", "asof"].includes(id) && mode !== "sample") mode = "manual";
  dirty();
});
$("demo").onclick = reset;
$("add").onclick = () => {
  if (rows.length >= 40) {
    $("message").textContent = "Limit: 40 contracts.";
    return;
  }
  const p = inputs();
  if (!Number.isFinite(p.asof) || !Number.isFinite(p.spot)) return;
  rows.push({
    strike: p.spot,
    expiry: p.asof + Math.max(p.horizon, 5) * 86400000,
    bid: 0,
    ask: 1,
    iv: p.vol,
  });
  mode = "manual";
  renderRows();
  dirty();
  $("message").textContent =
    "New row uses placeholder bid, ask and IV. Replace them with your quote.";
};
$("import").onclick = () => importQuotes($("csv").value);
$("upload").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 100000) {
    $("message").textContent = "CSV is too large (100 KB maximum).";
    return;
  }
  try {
    importQuotes(await f.text());
  } catch {
    $("message").textContent = "Could not read that file. Try pasting the CSV instead.";
  }
  e.target.value = "";
};
$("template").onclick = () => {
  const p = inputs();
  try {
    validate(p, rows);
  } catch (e) {
    $("message").textContent = e.message;
    return;
  }
  const text =
    "symbol,spot,quote_time,expiry,strike,bid,ask,iv_pct\n" +
    rows
      .map((c) =>
        [
          p.symbol,
          p.spot,
          new Date(p.asof).toISOString(),
          new Date(c.expiry).toISOString(),
          c.strike,
          c.bid,
          c.ask,
          c.iv * 100,
        ].join(","),
      )
      .join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = node("a", "");
  a.href = url;
  a.download = mode === "sample" ? "SYNTHETIC-sample-quotes.csv" : "entered-quotes.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("asof").value = dt(Math.floor(Date.now() / 1000) * 1000);
reset();
run();
