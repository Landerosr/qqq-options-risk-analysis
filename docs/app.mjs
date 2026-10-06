import { sampleRows, validate, price, YEAR } from "./model.mjs";
import { initCandles } from "./candles.mjs";
initCandles();
const $ = (id) => document.getElementById(id),
  money = (n) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    }).format(n),
  pct = (n) => (100 * n).toFixed(1) + "%",
  dt = (n) => Number.isFinite(new Date(n).getTime()) ? new Date(n).toISOString().slice(0, 19) : "";
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
      : `MANUALLY EDITED QUOTES · Not independently verified. ${ageText} ${age > 0.25 ? "Review stale prices before interpreting results." : ""}`;
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
    const typeCell = document.createElement("td"),
      typeInput = document.createElement("select");
    typeInput.setAttribute("aria-label", `Contract ${i + 1} type`);
    for (const type of ["call", "put"]) {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type === "call" ? "Call" : "Put";
      typeInput.append(option);
    }
    typeInput.value = c.type ?? "call";
    typeInput.addEventListener("change", () => {
      c.type = typeInput.value;
      if (mode === "sample") {
        const p = inputs(),
          fair = price(p.spot, c.strike, (c.expiry - p.asof) / YEAR, c.iv, p.rate, p.dividend, c.type);
        c.bid = Math.max(0, Math.round((fair - 0.05) * 100) / 100);
        c.ask = Math.max(0.01, Math.round((fair + 0.05) * 100) / 100);
      } else {
        // A call quote is not a put quote (or vice versa), even at the same strike.
        c.bid = c.ask = c.iv = NaN;
      }
      renderRows();
      dirty();
      $("message").textContent = mode === "sample"
        ? "Sample price regenerated for the selected option type. No market data was fetched."
        : "Contract type changed. Enter the matching bid, ask and IV before running analysis.";
    });
    typeCell.append(typeInput);
    tr.append(typeCell);
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
      input.value = key === "expiry" ? dt(c[key]) : !Number.isFinite(c[key]) ? "" : key === "iv" ? c[key] * 100 : c[key];
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
  $("beginner-contract").value = String(id);
  $("worthless-label").textContent = `Chance this ${c.type} expires worthless`;
  $("worthless").textContent = pct(c.worthlessProbability);
  $("worthless-explanation").textContent = `Selected $${c.strike} ${c.type} · stock at or ${c.type === "put" ? "above" : "below"} $${c.strike} on ${dt(c.expiry).slice(0, 10)} (UTC). You lose the premium and fees if held to expiration with no payoff.`;
  document
    .querySelectorAll(".comparison tr")
    .forEach((tr) => tr.classList.toggle("selected", Number(tr.dataset.id) === id));
  $("selected-title").textContent =
    `${result.p.symbol} $${c.strike} ${c.type} · ${c.days.toFixed(2)} calendar days`;
  const risk = $("risk");
  risk.replaceChildren();
  for (const [label, value] of [
    ["Maximum loss", money(c.cost)],
    ["95% VaR · horizon", money(c.var95)],
    ["95% CVaR · horizon", money(c.cvar95)],
    ["Profit at expiration", pct(c.expiryPop)],
    ["Expiry profit requires", c.type === "put" && c.breakeven <= 0 ? "No positive stock price" : `${c.type === "put" ? "Below" : "Above"} ${money(c.breakeven)}`],
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
  $("beginner-contract").replaceChildren(...r.contracts.map(c => {
    const option = node("option", `$${c.strike} ${c.type} · expires ${dt(c.expiry).slice(0, 10)}`);
    option.value = c.id;
    return option;
  }));
  $("beginner-contract").onchange = e => select(Number(e.target.value));
  $("touch").textContent = pct(r.touch);
  $("touch-explanation").textContent = `About ${Math.round(r.touch * 100)} out of 100 modeled paths reach ${money(r.p.target)} within ${r.p.horizon} calendar days.`;
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
    .sort((a, b) => a.strike - b.strike || a.expiry - b.expiry || a.type.localeCompare(b.type))
    .forEach((c) => {
      const tr = node("tr", "");
      tr.dataset.id = c.id;
      const td = node("td", ""),
        b = node("button", `$${c.strike} ${c.type}`);
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
        node("td", c.type === "put" && c.breakeven < 0 ? "Not attainable" : money(c.breakeven)),
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
$("scenario").addEventListener("submit", run);
$("scenario").addEventListener("input", (event) => {
  const id = event.target.id;
  if (id === "symbol") {
    rows = [];
    $("spot").value = "";
    $("asof").value = "";
    renderRows();
    mode = "manual";
    dirty();
    $("message").textContent = "Ticker changed. Enter the new underlying price, UTC snapshot and contract quotes. Your target and model assumptions were retained; review them for this ticker.";
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
    type: "call",
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
$("asof").value = dt(Math.floor(Date.now() / 1000) * 1000);
reset();
run();

const lessons = [
  ["Call or put?", "A call gives its holder the right to buy shares at the strike price; a put gives the right to sell. Choose the contract type explicitly. Buying either costs a premium."],
  ["When is it worthless?", "At expiration, a call has no payoff at or below its strike; a put has no payoff at or above its strike. Held to that point, the premium and fees are lost."],
  ["Target hit ≠ profit", "Touching your price target is different from making money. The option price also depends on time remaining and volatility."],
  ["Time decay", "Time passing generally reduces a bought option’s time value, with other factors unchanged. A correct direction can still produce a loss."],
  ["Break-even at expiration", "For net profit at expiration, a call needs the stock above strike plus premium and fees per share. A put needs it below strike minus premium and fees per share."],
  ["Probabilities are estimates", "These numbers use your volatility and growth assumptions. They describe a model, not a prediction or a guaranteed trading outcome."],
];
let lessonIndex = 0;
let lessonPaused = matchMedia("(prefers-reduced-motion: reduce)").matches;
function showLesson() {
  $("lesson-title").textContent = lessons[lessonIndex][0];
  $("lesson-text").textContent = lessons[lessonIndex][1];
  $("lesson-count").textContent = `${lessonIndex + 1} / ${lessons.length}`;
  $("lesson-pause").textContent = lessonPaused ? "Play" : "Pause";
}
function moveLesson(step) {
  const stage = $("lesson-stage");
  stage.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
  stage.querySelectorAll("[data-outgoing]").forEach(card => card.remove());
  const current = stage.querySelector(".lesson-card");
  const outgoing = current.cloneNode(true);
  outgoing.dataset.outgoing = "true";
  outgoing.setAttribute("aria-hidden", "true");
  outgoing.querySelectorAll("[id]").forEach(element => element.removeAttribute("id"));
  lessonIndex = (lessonIndex + step + lessons.length) % lessons.length;
  showLesson();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  stage.append(outgoing);
  const direction = step > 0 ? 1 : -1;
  const timing = { duration: 750, easing: "cubic-bezier(.22,.68,0,1)", fill: "both" };
  current.animate([{ transform: `translateX(${direction * 105}%)`, opacity: 0 }, { transform: "translateX(0)", opacity: 1 }], timing);
  const exit = outgoing.animate([{ transform: "translateX(0)", opacity: 1 }, { transform: `translateX(${direction * -105}%)`, opacity: 0 }], timing);
  exit.onfinish = () => outgoing.remove();
}
$("lesson-prev").onclick = () => { lessonPaused = true; moveLesson(-1); };
$("lesson-next").onclick = () => { lessonPaused = true; moveLesson(1); };
$("lesson-pause").onclick = () => { lessonPaused = !lessonPaused; showLesson(); };
setInterval(() => {
  if (!lessonPaused && !document.hidden) moveLesson(1);
}, 7000);
showLesson();
