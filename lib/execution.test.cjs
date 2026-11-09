'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHistory, parseDepth, parsePriceIncrements, parseServerTime } = require('./indodax.cjs');
const { sweep, measuredCosts, roundDown, feeRate, executeBuy, executeSell } = require('./execution.cjs');

test('parses Indodax history into sorted OHLCV bars', () => {
  const bars = parseHistory([
    { Time: 7200, Open: 2, High: 3, Low: 1, Close: 2.5, Volume: '8' },
    { Time: 3600, Open: 1, High: 2, Low: 0.5, Close: 1.5, Volume: '4' }
  ]);
  assert.deepEqual(bars.map(bar => bar.time), [3600, 7200]);
});

test('parses Indodax price increments', () => {
  assert.equal(parsePriceIncrements({ increments: { btc_idr: '1000', eth_idr: '1' } }).get('btc_idr'), 1000);
});

test('normalizes millisecond and second server timestamps to seconds', () => {
  assert.equal(parseServerTime({ server_time: 1_794_206_521_225 }), 1_794_206_521);
  assert.equal(parseServerTime({ server_time: 1_794_206_521 }), 1_794_206_521);
});

test('rejects empty books and marks excessive spreads invalid', () => {
  assert.throws(() => parseDepth({ buy: [], sell: [] }), /empty_order_book/);
  const wideBook = parseDepth({ buy: [[90, 1000]], sell: [[110, 1000]] });
  assert.equal(wideBook.valid, false);
  assert.throws(() => measuredCosts(wideBook, 25_000), /spread_over_2pct/);
});

test('sweeps multiple levels and calculates volume-weighted fill prices', () => {
  const fill = sweep([{ price: 10, volume: 2 }, { price: 12, volume: 2 }], 'BUY', 32);
  assert.equal(fill.quantity, 3);
  assert.equal(fill.averagePrice, 32 / 3);
  assert.equal(fill.complete, true);
});

test('rejects cost samples when the book cannot fill the requested size', () => {
  const thinBook = parseDepth({ buy: [[99, 100]], sell: [[101, 100]] });
  assert.throws(() => measuredCosts(thinBook, 25_000), /insufficient_depth_for_cost_sample/);
});

test('rounds base quantity down to the pair increment', () => {
  assert.equal(roundDown(1.239, 0.01), 1.23);
});

test('uses the higher published taker fee and fills buys/sells at book sides', () => {
  const book = parseDepth({ buy: [[99, 500], [98, 500]], sell: [[101, 500], [102, 500]] });
  const rate = feeRate({ trade_fee_percent_taker: '0.2' }, '0.25');
  assert.equal(rate, 0.0025);
  const buy = executeBuy(book, 30_000, rate, { quantity_increment: 0.01 });
  assert.ok(buy.averagePrice >= book.bestAsk);
  const sell = executeSell(book, buy.quantity, rate, { quantity_increment: 0.01 });
  assert.ok(sell.averagePrice <= book.bestBid);
});

test('refuses to trade when the official fee source has not been supplied', () => {
  assert.throws(() => feeRate({ trade_fee_percent_taker: '0.2' }, ''), /taker_fee_source_missing_or_invalid/);
});

test('uses the official all-in taker fee separately for IDR buys and sells', () => {
  const pair = { trade_fee_percent_taker: '0.2' };
  const official = { buy: '0.20555', sell: '0.41555' };
  assert.ok(Math.abs(feeRate(pair, official, 'BUY') - 0.0020555) < 1e-12);
  assert.ok(Math.abs(feeRate(pair, official, 'SELL') - 0.0041555) < 1e-12);
});