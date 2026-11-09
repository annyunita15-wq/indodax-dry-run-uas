'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('../config.cjs');
const { getHistory, getPairs, getPriceIncrements } = require('../lib/indodax.cjs');

const output = path.join(__dirname, '..', 'data', 'candles.json');
const start = Math.floor((Date.parse(process.env.BACKTEST_START || config.backtestStart) / 1000) - config.intervalSeconds * config.minimumBars);
const end = Math.floor(Date.parse(process.env.BACKTEST_END || config.freezeAt) / 1000);
const chunkSeconds = config.intervalSeconds * 600;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function download(symbol) {
  const found = new Map();
  let cursor = end;
  let requests = 0;
  while (cursor > start) {
    const from = Math.max(start, cursor - chunkSeconds);
    const bars = await getHistory(symbol, from, cursor, { retries: config.retryCount, gapMs: config.requestGapMs });
    requests++;
    if (!bars.length) throw new Error(`${symbol}: API tidak mengembalikan candle sebelum ${new Date(cursor * 1000).toISOString()}`);
    for (const bar of bars) if (bar.time >= start && bar.time <= end) found.set(bar.time, bar);
    const earliest = bars[0].time;
    if (earliest >= cursor) throw new Error(`${symbol}: pagination tidak bergerak mundur`);
    cursor = earliest;
    console.log(`${symbol}: ${found.size} bar, ${requests} permintaan, awal ${new Date(earliest * 1000).toISOString()}`);
    if (earliest <= start) break;
    await sleep(config.requestGapMs);
  }
  return [...found.values()].sort((a, b) => a.time - b.time);
}

async function main() {
  const data = {};
  const pairs = await getPairs({ retries: config.retryCount, gapMs: config.requestGapMs });
  await sleep(config.requestGapMs);
  const incrementMap = await getPriceIncrements({ retries: config.retryCount, gapMs: config.requestGapMs });
  const marketInfo = { downloadedAt: new Date().toISOString(), pairs: {}, increments: {} };
  for (const symbol of config.candidateSymbols) {
    try {
      const pair = pairs.get(symbol);
      if (!pair || pair.is_maintenance || pair.is_market_suspended) throw new Error('Pasangan tidak tersedia atau sedang dihentikan.');
      if (!Number.isFinite(Number(pair.quantity_increment)) || Number(pair.quantity_increment) <= 0) throw new Error('Increment kuantitas pasangan tidak valid.');
      const incrementKey = String(pair.ticker_id || `${pair.traded_currency}_idr`).toLowerCase();
      const increment = incrementMap.get(incrementKey);
      if (!Number.isFinite(increment) || increment <= 0) throw new Error(`Fraksi harga ${incrementKey} tidak ditemukan.`);
      marketInfo.pairs[symbol] = pair;
      marketInfo.increments[symbol] = increment;
      data[symbol] = await download(symbol);
    } catch (error) {
      console.error(`${symbol}: ${error.message}`);
      data[symbol] = { error: error.message, bars: [] };
    }
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ timeframe: config.timeframe, intervalSeconds: config.intervalSeconds, start: new Date(start * 1000).toISOString(), end: new Date(end * 1000).toISOString(), downloadedAt: new Date().toISOString(), data }, null, 2));
  fs.writeFileSync(path.join(path.dirname(output), 'market-info.json'), JSON.stringify(marketInfo, null, 2));
  const failed = Object.values(data).filter(item => !Array.isArray(item)).length;
  if (failed) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exitCode = 1; });