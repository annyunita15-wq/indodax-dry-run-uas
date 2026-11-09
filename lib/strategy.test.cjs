'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { closedBars, validateBars, evaluateSignal } = require('./strategy.cjs');

const interval = 4 * 60 * 60;
const params = { bb: 20, sd: 2, rsi: 10, os: 35, xr: 60 };

function risingBars(count = 25) {
  return Array.from({ length: count }, (_, index) => ({
    time: index * interval,
    open: 100 + index,
    high: 101 + index,
    low: 99 + index,
    close: 100 + index,
    volume: 1
  }));
}

test('excludes the still-open candle using server time', () => {
  const bars = risingBars(3);
  assert.equal(closedBars(bars, 3 * interval - 1, interval).length, 2);
  assert.equal(closedBars(bars, 3 * interval, interval).length, 3);
});

test('rejects gaps and non-positive market data', () => {
  const bars = risingBars(25);
  bars[8].time += 1;
  assert.equal(validateBars(bars, 25 * interval, interval, 21).reason, 'missing_candle');
  bars[8].time -= 1;
  bars[10].volume = 0;
  assert.equal(validateBars(bars, 25 * interval, interval, 21).reason, 'invalid_ohlcv');
});

test('produces a deterministic hold/flat action from closed bars', () => {
  const result = evaluateSignal(risingBars(), params);
  assert.equal(result.action, 'FLAT');
  assert.ok(Number.isFinite(result.rsi));
});

test('only emits a sell signal when a position exists', () => {
  const bars = risingBars();
  assert.equal(evaluateSignal(bars, { ...params, xr: 99 }).action, 'FLAT');
  assert.equal(evaluateSignal(bars, { ...params, xr: 99 }, true).action, 'SELL');
});