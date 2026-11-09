'use strict';

const configDefaults = require('../config.cjs');
const { evaluateSignal } = require('./strategy.cjs');
const { feeRate, executeBuy, executeSell } = require('./execution.cjs');

function wibDay(timestamp) {
  return new Date((timestamp + 7 * 3600) * 1000).toISOString().slice(0, 10);
}

function createState(config = configDefaults) {
  return { cash: config.capital, positions: {}, processed: {}, daily: null, equityDaily: [], lastMarks: {} };
}

function runTick(previousState, markets, options = {}) {
  const config = options.config || configDefaults;
  const timestamp = Number(options.timestamp);
  const date = wibDay(timestamp);
  const state = structuredClone(previousState || createState(config));
  const orders = [];
  const trades = [];
  const decisions = [];
  const errors = [];
  const bySymbol = new Map(markets.map(market => [market.symbol, market]));

  let equity = state.cash;
  for (const [symbol, position] of Object.entries(state.positions)) {
    const market = bySymbol.get(symbol);
    const bid = market?.book?.bestBid || state.lastMarks[symbol]?.bid;
    if (bid) {
      const rate = market ? feeRate(market.pair, options.officialFeePercent, 'SELL') : position.sellFeeRate;
      equity += position.quantity * bid * (1 - rate);
      if (market?.book?.bestBid) state.lastMarks[symbol] = { bid: market.book.bestBid, time: timestamp };
    } else {
      equity += position.markValue || 0;
    }
  }

  if (!state.daily || state.daily.day !== date) state.daily = { day: date, startingEquity: equity };
  const dailyReturn = state.daily.startingEquity ? equity / state.daily.startingEquity - 1 : 0;
  const dailyLossBlocked = dailyReturn <= -config.dailyLossLimit;
  if (!state.equityDaily.some(row => row.day === date)) state.equityDaily.push({ day: date, time: timestamp, equity: Math.round(equity) });
  const valid = markets.filter(market => market.validation?.ok && market.signalBars?.length);
  const signals = [];

  for (const market of valid) {
    const latest = market.signalBars.at(-1);
    if (state.processed[market.symbol] === latest.time) {
      decisions.push({ symbol: market.symbol, candleTime: latest.time, action: 'DUPLICATE_IGNORED' });
      continue;
    }
    const held = Boolean(state.positions[market.symbol]);
    const signal = evaluateSignal(market.signalBars, config.params, held);
    signals.push({ market, latest, signal });
    decisions.push({ symbol: market.symbol, candleTime: latest.time, action: signal.action, close: signal.close, rsi: signal.rsi });
  }

  for (const item of signals.filter(row => row.signal.action === 'SELL')) {
    const { market, latest, signal } = item;
    const position = state.positions[market.symbol];
    if (!position) continue;
    try {
      const rate = feeRate(market.pair, options.officialFeePercent, 'SELL');
      const fill = executeSell(market.book, position.quantity, rate, market.pair);
      const pnl = fill.proceeds - position.costBasis;
      const grossPnl = (signal.close - position.entrySignalPrice) * position.quantity;
      const costs = Math.abs((position.entryFill - position.entrySignalPrice) * position.quantity) +
        Math.abs((signal.close - fill.averagePrice) * position.quantity) + position.buyFee + fill.fee;
      state.cash += fill.proceeds;
      trades.push({ symbol: market.symbol, quantity: fill.quantity, entryTime: position.entryTime, exitTime: timestamp, entryPrice: position.entryFill, exitPrice: fill.averagePrice, buyFee: position.buyFee, sellFee: fill.fee, grossPnl, costs, pnl, entrySignalTime: position.signalTime, exitSignalTime: latest.time });
      orders.push({ time: timestamp, candleTime: latest.time, symbol: market.symbol, side: 'SELL', quantity: fill.quantity, bestBid: fill.bestBid, bestAsk: fill.bestAsk, fillPrice: fill.averagePrice, fee: fill.fee, signalPrice: signal.close, signalToFillPct: fill.averagePrice / signal.close - 1 });
      delete state.positions[market.symbol];
    } catch (error) {
      errors.push({ symbol: market.symbol, reason: error.message });
    }
  }

  const entries = signals.filter(row => row.signal.action === 'BUY')
    .sort((a, b) => a.signal.rsi - b.signal.rsi || a.market.symbol.localeCompare(b.market.symbol));
  for (const { market, latest, signal } of entries) {
    if (options.killSwitch || dailyLossBlocked || state.positions[market.symbol] || Object.keys(state.positions).length >= config.maxPositions) continue;
    try {
      const rate = feeRate(market.pair, options.officialFeePercent, 'BUY');
      const freePositionValue = config.maxPositionValue;
      const orderValue = Math.min(config.orderSize, freePositionValue, state.cash / (1 + rate));
      if (orderValue < config.minimumOrder) continue;
      const fill = executeBuy(market.book, orderValue, rate, market.pair);
      if (fill.quote + fill.fee > state.cash || fill.quote > config.maxPositionValue) continue;
      state.cash -= fill.totalCost;
      state.positions[market.symbol] = {
        quantity: fill.quantity,
        costBasis: fill.totalCost,
        buyFee: fill.fee,
        entryFill: fill.averagePrice,
        entrySignalPrice: signal.close,
        entryTime: timestamp,
        signalTime: latest.time,
        buyFeeRate: rate,
        sellFeeRate: feeRate(market.pair, options.officialFeePercent, 'SELL'),
        markValue: fill.quantity * fill.bestBid
      };
      state.lastMarks[market.symbol] = { bid: fill.bestBid, time: timestamp };
      orders.push({ time: timestamp, candleTime: latest.time, symbol: market.symbol, side: 'BUY', quantity: fill.quantity, bestBid: fill.bestBid, bestAsk: fill.bestAsk, fillPrice: fill.averagePrice, fee: fill.fee, signalPrice: signal.close, signalToFillPct: fill.averagePrice / signal.close - 1 });
    } catch (error) {
      errors.push({ symbol: market.symbol, reason: error.message });
    }
  }

  for (const { market, latest } of signals) state.processed[market.symbol] = latest.time;
  let markedEquity = state.cash;
  for (const [symbol, position] of Object.entries(state.positions)) {
    const market = bySymbol.get(symbol);
    const bid = market?.book?.bestBid || state.lastMarks[symbol]?.bid;
    if (bid) {
      const rate = market ? feeRate(market.pair, options.officialFeePercent, 'SELL') : position.sellFeeRate;
      position.markValue = position.quantity * bid * (1 - rate);
      markedEquity += position.markValue;
    } else {
      markedEquity += position.markValue || 0;
    }
  }
  state.lastEquity = Math.round(markedEquity);
  const call = {
    time: timestamp,
    day: date,
    processedCandles: decisions.filter(row => row.action !== 'DUPLICATE_IGNORED').length,
    duplicateCandles: decisions.filter(row => row.action === 'DUPLICATE_IGNORED').length,
    dailyLossBlocked,
    killSwitch: Boolean(options.killSwitch),
    equity: Math.round(equity),
    markedEquity: state.lastEquity,
    decisions,
    errors
  };
  return { state, call, orders, trades, snapshots: markets.map(market => market.snapshot).filter(Boolean) };
}

module.exports = { wibDay, createState, runTick };