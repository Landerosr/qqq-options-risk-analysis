// Optional UI regression suite: npm install --no-save --package-lock=false playwright
// Use an installed Chromium with CHROMIUM_BIN, or run: npx playwright install chromium
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { createServer } = require("node:http");
const { readFile } = require("node:fs/promises");
const { existsSync } = require("node:fs");
const { resolve, sep, extname } = require("node:path");

(async () => {
  const root = resolve(__dirname, "docs");
  const server = createServer(async (req, res) => {
    const name = new URL(req.url, "http://localhost").pathname;
    const path = resolve(root, "." + (name === "/" ? "/index.html" : name));
    if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(path);
      const mime = { ".mjs": "text/javascript", ".html": "text/html", ".css": "text/css" }[extname(path)];
      res.writeHead(200, { "Content-Type": mime || "application/octet-stream" }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true,
      executablePath: process.env.CHROMIUM_BIN || (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    // Local-app regression tests must not rely on or send requests to chart providers.
    await page.route("**/*", route => route.request().url().startsWith("http://127.0.0.1:") ? route.continue() : route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const selector = i => page.getByLabel(`Contract ${i} type`, { exact: true });
    const field = (i, name) => page.getByLabel(`Contract ${i} ${name}`, { exact: true });
    const run = async () => { await page.locator("#run").click(); await page.locator("#results").waitFor({ state: "visible" }); };
    await page.locator("#results").waitFor({ state: "visible" });
    assert.equal(await page.locator("#contracts tr").count(), 6);
    assert.equal(await selector(1).inputValue(), "call");
    const originalAsk = await field(1, "ask").inputValue();
    await selector(1).selectOption("put");
    assert.equal(await selector(1).inputValue(), "put");
    assert.equal(await page.locator("#results").isVisible(), false);
    assert.match(await page.locator("#data-status").innerText(), /SAMPLE DATA/);
    assert.notEqual(await field(1, "ask").inputValue(), originalAsk);
    await run();
    await page.locator("#beginner-contract").selectOption("0");
    assert.match(await page.locator("#selected-title").innerText(), /put/);
    assert.match(await page.locator("#worthless-label").innerText(), /put/);
    assert.match(await page.locator("#worthless-explanation").innerText(), /at or above/);
    assert.match(await page.locator('#comparison tr[data-id="0"] td').nth(6).innerText(), /^-/);
    await page.locator("#target").fill("700");
    await run();
    assert.equal(await selector(1).inputValue(), "put");
    assert.equal(await selector(2).inputValue(), "call");
    assert.match(await page.locator("#direction").innerText(), /or below/);
    await field(1, "strike").fill("710");
    assert.equal(await selector(1).inputValue(), "put");

    // Manual type changes invalidate the old type's quotes, but preserve identity.
    const expiry = await field(1, "expiry UTC").inputValue();
    await selector(1).selectOption("call");
    for (const key of ["bid", "ask", "iv"]) assert.equal(await field(1, key).inputValue(), "");
    assert.equal(await field(1, "strike").inputValue(), "710");
    assert.equal(await field(1, "expiry UTC").inputValue(), expiry);
    await page.locator("#run").click();
    assert.equal(await page.locator("#results").isVisible(), false);
    assert.match(await page.locator("#message").innerText(), /check strike, bid/);

    // Interrupted editing previously threw and removed the contract table.
    await field(2, "expiry UTC").fill("");
    await selector(2).selectOption("put");
    assert.equal(await page.locator("#contracts tr").count(), 6);
    assert.equal(await field(2, "expiry UTC").inputValue(), "");
    assert.equal(await selector(2).inputValue(), "put");
    await selector(2).selectOption("call");
    await selector(2).selectOption("put");
    assert.equal(await page.locator("#contracts tr").count(), 6);
    await page.locator("#add").click();
    assert.equal(await page.locator("#contracts tr").count(), 7);
    await page.getByLabel("Remove contract 2", { exact: true }).click();
    assert.equal(await page.locator("#contracts tr").count(), 6);
    assert.deepEqual(errors, []);

    // Reset remains an explicit call-only synthetic example and permits a fresh run.
    await page.locator("#demo").click();
    assert.equal(await selector(1).inputValue(), "call");
    assert.equal(await page.locator("#contracts tr").count(), 6);
    await run();

    await page.getByText("Model assumptions & data", { exact: true }).click();

    // Editing while a detailed worker is active must cancel it, without stale results.
    await page.locator("#paths").selectOption("100000");
    await page.evaluate(() => {
      document.getElementById("run").click();
      const select = document.querySelector("#contracts select");
      select.value = "put";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(300);
    assert.equal(await page.locator("#results").isVisible(), false);
    assert.equal(await page.locator("#run").isDisabled(), false);
    assert.equal(await selector(1).inputValue(), "put");
    await page.locator("#paths").selectOption("20000");
    await run();

    // Ticker edit must not relabel old contracts or spot data as a new ticker.
    await page.locator("#symbol").fill("AAPL");
    assert.match(await page.locator("#yahoo").getAttribute("href"), /\/AAPL\/options\//);
    assert.equal(await page.locator("#contracts tr").count(), 0);
    assert.equal(await page.locator("#spot").inputValue(), "");
    assert.equal(await page.locator("#asof").inputValue(), "");
    assert.equal(await page.locator("#results").isVisible(), false);
    assert.match(await page.locator("#message").innerText(), /target and model assumptions were retained/);
    await page.locator("#spot").fill("100");
    await page.locator("#asof").fill(new Date(Date.now() - 60000).toISOString().slice(0, 19));
    await page.locator("#add").click();
    assert.equal(await page.locator("#contracts tr").count(), 1);
    await page.locator("#symbol").fill("MSFT");
    assert.equal(await page.locator("#contracts tr").count(), 0);
    assert.equal(await page.locator("#spot").inputValue(), "");

    // Narrow viewport keeps labels and selectors reachable without page-wide overflow.
    await page.reload();
    await page.locator("#results").waitFor({ state: "visible" });
    await page.setViewportSize({ width: 390, height: 844 });
    await selector(1).selectOption("put");
    await run();
    assert.equal(await selector(1).inputValue(), "put");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
    console.log("PASS: selectors, call/put results, preserved type, manual quote invalidation, interrupted expiry, repeated edits, reset, worker cancellation, ticker safety, and mobile layout; no uncaught page errors");
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
