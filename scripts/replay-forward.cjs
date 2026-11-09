'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('../config.cjs');
const { evaluateSignal } = require('../lib/strategy.cjs');
const { performance } = require('../lib/report.cjs');

const root = path.join(__dirname, '..');
const start = Math.floor(Date.parse(config.freezeAt) / 1000);
const end = Math.floor(Date.parse(config.forwardEnd) / 1000);

function read(name) { return JSON.parse(fs.readFileSync(path.join(root, 'data', name), 'utf8')); }
function feeRate(records, symbol, time, side) {
  const rows = records.filter(row => (row.symbol === symbol || row.symbol === '*') && Date.parse(`${row.effectiveFrom}T00:00:00Z`) <= time)
    .sort((a, b) => Date.parse(`${b.effectiveFrom}T00:00:00Z`) - Date.parse(`${a.effectiveFrom}T00:00:00Z`));
  const row = rows[0];
  const official = typeof row?.officialTakerPercent === 'object' ? row.officialTakerPercent[side.toLowerCase()] : row?.officialTakerPercent;
  if (!row || row.apiTakerPercent == null || official == null || !row.accessedAt) throw new Error(`Fee ${symbol} tidak lengkap pada ${new Date(time * 1000).toISOString()}.`);
  return Math.max(Number(row.apiTakerPercent), Number(official)) / 100;
}

function main() {
  const candles = read('candles.json').data;
  const universe = read('universe.json');
  const backtest = read('backtest.json');
  const marketInfo = read('market-info.json');
  const feeRows = read('fee-rates.json');
  const series = new Map(universe.symbols.map(symbol => {
    if (!Array.isArray(candles[symbol])) throw new Error(`Candle ${symbol} tidak tersedia.`);
    return [symbol, candles[symbol]];
  }));
  const times = [...new Set([...series.values()].flat().filter(bar => bar.time + config.intervalSeconds > start && bar.time <= end).map(bar => bar.time))].sort((a, b) => a - b);
  if (!times.length || times.at(-1) < end - config.intervalSeconds * 2) throw new Error('Data candle belum mencakup sepuluh hari penuh setelah freeze.');

  const positions = new Map();
  const pending = new Map();
  const orders = [];
  const trades = [];
  const equity = [[start, config.capital]];
  const signals = [];
  let cash = config.capital;
  let wibDay = null;
  let dayStartEquity = config.capital;

  for (const time of times) {
    let openEquity = cash;
    for (const [symbol, position] of positions) {
      const bar = series.get(symbol).find(item => item.time === time);
      if (bar) {
        const cost = backtest.costs[symbol];
        openEquity += position.quantity * bar.open * (1 - cost.spread / 2 - cost.sellSlippage) * (1 - feeRate(feeRows, symbol, time, 'SELL'));
      }
    }
    const currentDay = new Date((time + 7 * 3600) * 1000).toISOString().slice(0, 10);
    if (currentDay !== wibDay) {
      wibDay = currentDay;
      dayStartEquity = openEquity;
    }
    const dailyLossBlocked = openEquity <= dayStartEquity * (1 - config.dailyLossLimit);
    const due = universe.symbols.map(symbol => ({ symbol, order: pending.get(`${symbol}|${time}`) })).filter(row => row.order);
    const runOrder = ({ symbol, order }) => {
      const bar = series.get(symbol).find(item => item.time === time);
      if (!bar) return;
      const cost = backtest.costs[symbol];
      const rate = feeRate(feeRows, symbol, time, order.action);
      if (order.action === 'SELL' && positions.has(symbol)) {
        const position = positions.get(symbol);
        const increment = marketInfo.increments[symbol];
        const rawFill = bar.open * (1 - cost.spread / 2 - cost.sellSlippage);
        const fill = Math.floor((rawFill + increment * 1e-9) / increment) * increment;
        const gross = fill * position.quantity;
        const sellFee = gross * rate;
        const proceeds = gross - sellFee;
        const grossPnl = (bar.open - position.entryOpen) * position.quantity;
        const costs = Math.abs((position.entryFill - position.entryOpen) * position.quantity) + Math.abs((bar.open - fill) * position.quantity) + position.buyFee + sellFee;
        const pnl = proceeds - position.costBasis;
        cash += proceeds;
        positions.delete(symbol);
        trades.push({ symbol, entryTime: position.entryTime, exitTime: time, quantity: position.quantity, entryPrice: position.entryFill, exitPrice: fill, buyFee: position.buyFee, sellFee, grossPnl, costs, pnl });
        orders.push({ time, symbol, side: 'SELL', quantity: position.quantity, referenceOpen: bar.open, fillPrice: fill, fee: sellFee, bookSource: 'median_pre_freeze_snapshots' });
      } else if (order.action === 'BUY' && !dailyLossBlocked && !positions.has(symbol) && positions.size < config.maxPositions) {
        const increment = marketInfo.increments[symbol];
        const quantityStep = Number(marketInfo.pairs[symbol]?.quantity_increment);
        const notional = Math.min(config.orderSize, config.maxPositionValue, cash / (1 + rate));
        const rawFill = bar.open * (1 + cost.spread / 2 + cost.buySlippage);
        const fill = Math.ceil((rawFill - increment * 1e-9) / increment) * increment;
        const quantity = Math.floor((notional / fill + quantityStep * 1e-9) / quantityStep) * quantityStep;
        const quote = quantity * fill;
        const buyFee = quote * rate;
        if (quote >= config.minimumOrder && quote + buyFee <= cash) {
          cash -= quote + buyFee;
          positions.set(symbol, { quantity, costBasis: quote + buyFee, buyFee, entryFill: fill, entryOpen: bar.open, entryTime: time });
          orders.push({ time, symbol, side: 'BUY', quantity, referenceOpen: bar.open, fillPrice: fill, fee: buyFee, bookSource: 'median_pre_freeze_snapshots' });
        }
      }
    };
    due.filter(row => row.order.action === 'SELL').forEach(runOrder);
    due.filter(row => row.order.action === 'BUY').sort((a, b) => a.order.rsi - b.order.rsi || a.symbol.localeCompare(b.symbol)).forEach(runOrder);

    let value = cash;
    for (const [symbol, position] of positions) {
      const bar = series.get(symbol).find(item => item.time === time);
      if (!bar) continue;
      const cost = backtest.costs[symbol];
      const markedPrice = bar.time + config.intervalSeconds <= end ? bar.close : bar.open;
      value += position.quantity * markedPrice * (1 - cost.spread / 2 - cost.sellSlippage) * (1 - feeRate(feeRows, symbol, time, 'SELL'));
    }
    equity.push([Math.min(time + config.intervalSeconds, end), Math.round(value)]);

    for (const symbol of universe.symbols) {
      const bars = series.get(symbol);
      const index = bars.findIndex(bar => bar.time === time);
      if (index < 0 || index < config.minimumBars - 1 || index + 1 >= bars.length) continue;
      const bar = bars[index];
      const next = bars[index + 1];
      if (bar.time + config.intervalSeconds > end) continue;
      if (next.time !== time + config.intervalSeconds || next.time > end) continue;
      const signal = evaluateSignal(bars.slice(0, index + 1), config.params, positions.has(symbol));
      signals.push({ symbol, candleTime: time, action: signal.action, rsi: signal.rsi });
      if (signal.action === 'BUY' || signal.action === 'SELL') pending.set(`${symbol}|${next.time}`, { action: signal.action, rsi: signal.rsi });
    }
  }

  const years = (equity.at(-1)[0] - equity[0][0]) / (365.25 * 86400);
  const summary = {
    period: { start: new Date(start * 1000).toISOString(), end: new Date(equity.at(-1)[0] * 1000).toISOString() },
    initialCapital: config.capital,
    equity,
    trades,
    orders,
    signals,
    metrics: performance(equity, trades, config.capital, years),
    benchmark: (() => {
      const bars = candles.BTCIDR?.filter(bar => bar.time + config.intervalSeconds > start && bar.time + config.intervalSeconds <= end) || [];
      return bars.length > 1 ? { returnTotal: bars.at(-1).close / bars[0].close - 1, start: bars[0].time, end: bars.at(-1).time } : null;
    })()
  };
  fs.writeFileSync(path.join(root, 'data', 'forward-replay.json'), JSON.stringify(summary, null, 2));
  console.log(`Replay ${trades.length} trade; ${(summary.metrics.returnTotal * 100).toFixed(2)}%; ${signals.length} sinyal dihitung.`);
}

try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }