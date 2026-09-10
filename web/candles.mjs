export function chartConfig(ticker, interval = '60') {
  const symbol = ticker.trim().toUpperCase();
  if (!/^[A-Z^][A-Z0-9.^-]{0,11}$/.test(symbol)) return null;
  if (!['30', '60', '240'].includes(interval)) return null;
  const exchanges = { AAPL: 'NASDAQ:AAPL', QQQ: 'NASDAQ:QQQ', MSFT: 'NASDAQ:MSFT', AMZN: 'NASDAQ:AMZN', NVDA: 'NASDAQ:NVDA', TSLA: 'NASDAQ:TSLA', SPY: 'AMEX:SPY' };
  return {
    autosize: true, symbol: exchanges[symbol] ?? symbol, interval,
    timezone: 'America/Chicago', theme: 'light', style: '1', locale: 'en',
    allow_symbol_change: false, hide_side_toolbar: true, hide_top_toolbar: true,
    hide_legend: false, hide_volume: true, calendar: false, details: false,
    hotlist: false, save_image: false, withdateranges: false,
    studies: [], compareSymbols: [], watchlist: [],
    backgroundColor: '#ffffff', gridColor: 'rgba(46, 46, 46, 0.06)',
  };
}

export function initCandles() {
  const ticker = document.getElementById('symbol');
  const host = document.getElementById('candle-chart');
  const status = document.getElementById('candle-status');
  const link = document.getElementById('candle-link');
  let interval = '60';
  let timer;
  function render() {
    clearTimeout(timer);
    const config = chartConfig(ticker.value, interval);
    host.replaceChildren();
    if (!config) {
      status.textContent = 'Enter a valid ticker above, such as AAPL for Apple.';
      link.hidden = true;
      return;
    }
    const label = interval === '30' ? '30 min' : interval === '60' ? '1H' : '4H';
    status.textContent = `${config.symbol} · ${label} candles · Central time. Check the exchange and delay label inside the chart.`;
    link.hidden = false;
    link.href = `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(config.symbol)}&interval=${interval}`;
    // A separate document isolates rapid symbol changes and third-party loading.
    // Only validated ticker characters and fixed configuration enter this document.
    const frame = document.createElement('iframe');
    frame.title = `${config.symbol} ${label} candlestick chart by TradingView`;
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    frame.srcdoc = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;font:14px system-ui;background:white}.tradingview-widget-container{height:100%;width:100%}.tradingview-widget-container__widget{height:calc(100% - 32px);width:100%}.tradingview-widget-copyright{height:32px;display:flex;align-items:center;justify-content:center;gap:4px}a{color:#165bda}</style></head><body><div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div><div class="tradingview-widget-copyright"><a href="https://www.tradingview.com/" rel="noopener nofollow" target="_blank">${config.symbol} chart by TradingView</a></div><script src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js" async>${JSON.stringify(config)}</script></div></body></html>`;
    host.append(frame);
  }
  ticker.addEventListener('input', () => {
    clearTimeout(timer);
    host.replaceChildren();
    link.hidden = true;
    status.textContent = 'Updating chart for your ticker…';
    timer = setTimeout(render, 650);
  });
  ticker.addEventListener('change', render);
  document.querySelectorAll('[data-candle-interval]').forEach(button => {
    button.addEventListener('click', () => {
      interval = button.dataset.candleInterval;
      document.querySelectorAll('[data-candle-interval]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
      render();
    });
  });
  document.getElementById('candle-reload').addEventListener('click', render);
  render();
}
