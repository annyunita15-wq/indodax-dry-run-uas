'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('../config.cjs');
const { evaluateSignal } = require('../lib/strategy.cjs');
const { performance } = require('../lib/report.cjs');

const root = path.join(__dirname, '..');
const start = Math.floor(Date.parse(process.env.BACKTEST_START || config.backtestStart) / 1000);
const freeze = Math.floor(Date.parse(process.env.BACKTEST_END || config.freezeAt) / 1000);

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'data', name), 'utf8'));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}

function feeRate(records, symbol, date) {
  const rows = records.filter(row => (row.symbol === symbol || row.symbol === '*') && Date.parse(`${row.effectiveFrom}T00:00:00Z`) <= date);
  rows.sort((a, b) => Date.parse(`${b.effectiveFrom}T00:00:00Z`) - Date.parse(`${a.effectiveFrom}T00:00:00Z`));
  const row = rows[0];
  if (!row || row.apiTakerPercent == null || row.officialTakerPercent == null || !Number.isFinite(Number(row.apiTakerPercent)) || !Number.isFinite(Number(row.officialTakerPercent)) || !row.accessedAt) {
    throw new Error(`Biaya ${symbol} pada ${new Date(date * 1000).toISOString().slice(0, 10)} belum dilengkapi dengan dua sumber dan tanggal akses di data/fee-rates.json.`);
  }
  return Math.max(Number(row.apiTakerPercent), Number(row.officialTakerPercent)) / 100;
}

function main() {
  for (const name of ['data/fee-rates.json', 'data/snapshots.jsonl', 'data/market-info.json']) {
    if (!fs.existsSync(path.join(root, name))) throw new Error(`Prasyarat belum ada: ${name}. Lihat bagian Data dan hitung ulang di README.md.`);
  }
  const candleData = readJson('candles.json');
  const universe = readJson('universe.json');
  const marketInfo = readJson('market-info.json');
  const feeRows = readJson('fee-rates.json');
  const snapshotFile = path.join(root, 'data', 'snapshots.jsonl');
  const snapshots = fs.readFileSync(snapshotFile, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const snapshotStart = Date.parse(config.snapshotStart);
  const eligibleSnapshots = snapshots.filter(row => Date.parse(row.capturedAt) >= snapshotStart && Date.parse(row.capturedAt) <= freeze && !row.error &&
    Number.isFinite(row.spread) && Number.isFinite(row.buySlippage) && Number.isFinite(row.sellSlippage));
  const costs = {};
  const series = new Map();
  const timeline = new Set();

  for (const symbol of universe.symbols) {
    const rows = eligibleSnapshots.filter(row => row.symbol === symbol);
    const byDay = new Map();
    for (const row of rows) {
      const day = new Date(Date.parse(row.capturedAt) + 7 * 3600_000).toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) || 0) + 1);
    }
    const requiredDays = ['2026-11-02', '2026-11-03', '2026-11-04'];
    const insufficientDay = requiredDays.find((day, index) => (byDay.get(day) || 0) < (index === 2 ? 2 : 3));
    if (rows.length < 8 || insufficientDay) {
      throw new Error(`${symbol}: snapshot pra-freeze tidak lengkap; perlu >=3/hari pada 2–3 Nov dan >=2 pada 4 Nov (gagal: ${insufficientDay || 'jumlah total'}).`);
    }
    costs[symbol] = {
      spread: median(rows.map(row => row.spread)),
      buySlippage: median(rows.map(row => row.buySlippage)),
      sellSlippage: median(rows.map(row => row.sellSlippage)),
      samples: rows.length,
      period: [rows[0].capturedAt, rows.at(-1).capturedAt]
    };

    const bars = candleData.data[symbol];
    if (!Array.isArray(bars)) throw new Error(`Data candle tidak tersedia untuk ${symbol}.`);
    const filtered = bars.filter(bar => bar.time + config.intervalSeconds <= freeze);
    const from = filtered.findIndex(bar => bar.time >= start);
    if (from < 0 || filtered.length - from < 3 * 365 * 86400 / config.intervalSeconds) {
      throw new Error(`${symbol}: data efektif kurang dari 3 tahun.`);
    }
    series.set(symbol, filtered);
    for (const bar of filtered) if (bar.time >= start && bar.time <= freeze) timeline.add(bar.time);
  }

  const symbols = universe.symbols;
  const positions = new Map();
  const trades = [];
  const orders = [];
  const equity = [];
  const pending = new Map();
  let cash = config.capital;
  let wibDay = null;
  let dayStartEquity = config.capital;
  const times = [...timeline].sort((a, b) => a - b);

  for (const time of times) {
    let openEquity = cash;
    for (const [symbol, position] of positions) {
      const bar = series.get(symbol).find(row => row.time === time);
      if (bar) {
        const cost = costs[symbol];
        const rate = feeRate(feeRows, symbol, time);
        openEquity += position.quantity * bar.open * (1 - cost.spread / 2 - cost.sellSlippage) * (1 - rate);
      }
    }
    const currentDay = new Date((time + 7 * 3600) * 1000).toISOString().slice(0, 10);
    if (currentDay !== wibDay) {
      wibDay = currentDay;
      dayStartEquity = openEquity;
    }
    const dailyLossBlocked = openEquity <= dayStartEquity * (1 - config.dailyLossLimit);
    const dueSymbols = [
      ...symbols.filter(symbol => pending.get(`${symbol}|${time}`)?.action === 'SELL'),
      ...symbols.filter(symbol => pending.get(`${symbol}|${time}`)?.action === 'BUY')
        .sort((a, b) => pending.get(`${a}|${time}`).rsi - pending.get(`${b}|${time}`).rsi || a.localeCompare(b))
    ];
    for (const symbol of dueSymbols) {
      const order = pending.get(`${symbol}|${time}`);
      if (!order) continue;
      const cost = costs[symbol];
      const rate = feeRate(feeRows, symbol, time);
      const bar = series.get(symbol).find(row => row.time === time);
      if (!bar) continue;
      if (order.action === 'BUY' && !dailyLossBlocked && !positions.has(symbol) && positions.size < config.maxPositions) {
        const increment = marketInfo.increments[symbol];
        const quantityStep = Number(marketInfo.pairs[symbol]?.quantity_increment);
        const orderValue = Math.min(config.orderSize, config.maxPositionValue, cash / (1 + rate));
        const rawFill = bar.open * (1 + cost.spread / 2 + cost.buySlippage);
        const fillPrice = Math.ceil((rawFill - increment * 1e-9) / increment) * increment;
        const quantity = Math.floor((orderValue / fillPrice + quantityStep * 1e-9) / quantityStep) * quantityStep;
        const notional = quantity * fillPrice;
        const fee = notional * rate;
        if (notional >= config.minimumOrder && notional + fee <= cash) {
          cash -= notional + fee;
          positions.set(symbol, { quantity, notional, buyFee: fee, entryPrice: fillPrice, entryOpen: bar.open, entryTime: time, entrySignalTime: order.signalTime, feeRate: rate });
          orders.push({ time, signalTime: order.signalTime, symbol, side: 'BUY', quantity, referenceOpen: bar.open, fillPrice, fee, spread: cost.spread, slippage: cost.buySlippage, bookSource: 'median_pre_freeze_snapshots' });
        }
      } else if (order.action === 'SELL' && positions.has(symbol)) {
        const position = positions.get(symbol);
        const increment = marketInfo.increments[symbol];
        const rawFill = bar.open * (1 - cost.spread / 2 - cost.sellSlippage);
        const fillPrice = Math.floor((rawFill + increment * 1e-9) / increment) * increment;
        const gross = position.quantity * fillPrice;
        const fee = gross * rate;
        const proceeds = gross - fee;
        const grossPnl = position.quantity * (bar.open - position.entryOpen);
        const totalCosts = Math.abs(position.quantity * (position.entryPrice - position.entryOpen)) +
          Math.abs(position.quantity * (bar.open - fillPrice)) + position.buyFee + fee;
        const pnl = proceeds - position.notional - position.buyFee;
        cash += proceeds;
        positions.delete(symbol);
        trades.push({ symbol, entryTime: position.entryTime, exitTime: time, quantity: position.quantity, entryPrice: position.entryPrice, exitPrice: fillPrice, buyFee: position.buyFee, sellFee: fee, grossPnl, costs: totalCosts, pnl, entrySignalTime: position.entrySignalTime, exitSignalTime: order.signalTime });
        orders.push({ time, signalTime: order.signalTime, symbol, side: 'SELL', quantity: position.quantity, referenceOpen: bar.open, fillPrice, fee, spread: cost.spread, slippage: cost.sellSlippage, bookSource: 'median_pre_freeze_snapshots' });
      }
    }

    let value = cash;
    for (const [symbol, position] of positions) {
      const bar = series.get(symbol).find(row => row.time === time);
      if (!bar) continue;
      const cost = costs[symbol];
      const rate = feeRate(feeRows, symbol, time);
      value += position.quantity * bar.close * (1 - cost.spread / 2 - cost.sellSlippage) * (1 - rate);
    }
    equity.push([time + config.intervalSeconds, Math.round(value)]);

    for (const symbol of symbols) {
      const bars = series.get(symbol);
      const index = bars.findIndex(row => row.time === time);
      if (index < 0 || index + 1 >= bars.length) continue;
      const current = bars[index];
      const next = bars[index + 1];
      if (next.time - current.time !== config.intervalSeconds || next.time > freeze) continue;
      const history = bars.slice(0, index + 1);
      if (history.length < config.minimumBars) continue;
      const signal = evaluateSignal(history, config.params, positions.has(symbol));
      if (signal.action === 'BUY' || signal.action === 'SELL') pending.set(`${symbol}|${next.time}`, { action: signal.action, signalTime: time, rsi: signal.rsi });
    }
  }

  const years = (equity.at(-1)[0] - equity[0][0]) / (365.25 * 86400);
  const benchmarkBars = (candleData.data.BTCIDR || []).filter(bar => bar.time >= start && bar.time + config.intervalSeconds <= freeze);
  const benchmark = benchmarkBars.length > 1 ? {
    symbol: 'BTCIDR',
    start: new Date(benchmarkBars[0].time * 1000).toISOString(),
    end: new Date(benchmarkBars.at(-1).time * 1000).toISOString(),
    returnTotal: benchmarkBars.at(-1).close / benchmarkBars[0].close - 1
  } : null;
  const summary = {
    period: { start: new Date(equity[0][0] * 1000).toISOString(), end: new Date(equity.at(-1)[0] * 1000).toISOString(), years },
    initialCapital: config.capital,
    params: config.params,
    timeframe: config.timeframe,
    symbols,
    costs,
    equity,
    trades,
    openPositions: [...positions.entries()].map(([symbol, position]) => ({ symbol, ...position })),
    orders,
    benchmark,
    metrics: performance(equity, trades, config.capital, years),
    source: 'Candle Indodax asli; eksekusi pada open candle berikutnya dengan median spread/slippage dari snapshot pra-freeze.'
  };
  fs.writeFileSync(path.join(root, 'data', 'backtest.json'), JSON.stringify(summary, null, 2));
  console.log(`Backtest: ${trades.length} closed trades; return ${(summary.metrics.returnTotal * 100).toFixed(2)}%; hasil data/backtest.json`);
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }