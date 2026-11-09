'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config.cjs');
const { parseDepth } = require('./indodax.cjs');
const { createState, runTick } = require('./tick-engine.cjs');

const bars = Array.from({ length: 30 }, (_, index) => ({
  time: index * config.intervalSeconds,
  open: 100 + index,
  high: 101 + index,
  low: 99 + index,
  close: 100 + index,
  volume: 1
}));
const oversoldBars = bars.map(bar => ({ ...bar }));
oversoldBars[oversoldBars.length - 1] = { ...oversoldBars.at(-1), open: 91, high: 92, low: 89, close: 90 };
const market = (time = bars.at(-1).time, oversold = false) => ({
  symbol: 'BTCIDR',
  validation: { ok: true },
  signalBars: (oversold ? oversoldBars : bars).map(bar => ({ ...bar, time: bar.time + time - bars.at(-1).time })),
  book: parseDepth({ buy: [[99, 1000]], sell: [[101, 1000]] }),
  pair: { trade_fee_percent_taker: '0.2', quantity_increment: 0.01 }
});

test('records each candle once and ignores a repeated tick', () => {
  const state = createState();
  const first = runTick(state, [market(bars.at(-1).time, true)], { timestamp: bars.at(-1).time + config.intervalSeconds, officialFeePercent: '0.25' });
  const second = runTick(first.state, [market(bars.at(-1).time, true)], { timestamp: bars.at(-1).time + config.intervalSeconds, officialFeePercent: '0.25' });
  assert.equal(second.call.duplicateCandles, 1);
  assert.equal(second.orders.length, 0);
  assert.ok(first.state.cash < state.cash);
  assert.equal(second.state.cash, first.state.cash);
});

test('kill switch blocks buys while allowing an existing position to exit', () => {
  const timestamp = bars.at(-1).time + config.intervalSeconds;
  const blocked = runTick(createState(), [market(timestamp - config.intervalSeconds, true)], { timestamp, officialFeePercent: '0.25', killSwitch: true });
  assert.equal(blocked.call.killSwitch, true);
  assert.equal(blocked.orders.length, 0);

  const state = createState();
  state.positions.BTCIDR = { quantity: 1, costBasis: 100, buyFee: 0, entryFill: 100, entrySignalPrice: 100, feeRate: 0.0025 };
  state.cash -= 100;
  const exited = runTick(state, [market()], { timestamp, officialFeePercent: '0.25', killSwitch: true });
  assert.ok(exited.orders.some(order => order.side === 'SELL'));
});

test('daily loss limit blocks new entries before the day changes', () => {
  const timestamp = bars.at(-1).time + config.intervalSeconds;
  const state = createState();
  state.cash -= 50_000_000;
  state.positions.BTCIDR = { quantity: 1, costBasis: 50_000_000, buyFee: 0, entryFill: 50_000_000, entrySignalPrice: 50_000_000, feeRate: 0.0025 };
  state.daily = { day: new Date((timestamp + 7 * 3600) * 1000).toISOString().slice(0, 10), startingEquity: 100_000_000 };
  const result = runTick(state, [market(timestamp - config.intervalSeconds, true)], { timestamp, officialFeePercent: '0.25' });
  assert.equal(result.call.dailyLossBlocked, true);
  assert.equal(result.orders.length, 0);
});

test('daily loss uses WIB midnight and marks open positions at bid', () => {
  const timestamp = Math.floor(Date.UTC(2026, 10, 9, 17, 0) / 1000);
  const state = createState();
  state.cash -= 50_000_000;
  state.positions.BTCIDR = { quantity: 1, costBasis: 50_000_000, buyFee: 0, entryFill: 50_000_000, entrySignalPrice: 50_000_000, feeRate: 0.0025 };
  state.daily = { day: '2026-11-09', startingEquity: 100_000_000 };
  const result = runTick(state, [market()], { timestamp, officialFeePercent: '0.25' });
  assert.equal(result.state.daily.day, '2026-11-10');
  assert.equal(result.call.dailyLossBlocked, false);
});