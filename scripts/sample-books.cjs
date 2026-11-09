'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('../config.cjs');
const { getDepth, getServerTime } = require('../lib/indodax.cjs');
const { measuredCosts } = require('../lib/execution.cjs');

async function main() {
  const root = path.join(__dirname, '..');
  const universe = JSON.parse(fs.readFileSync(path.join(root, 'data', 'universe.json'), 'utf8'));
  const output = path.join(root, 'data', 'snapshots.jsonl');
  const serverTime = await getServerTime({ retries: config.retryCount, gapMs: config.requestGapMs });
  const rows = [];
  for (const symbol of universe.symbols) {
    let book;
    try {
      book = await getDepth(symbol, { retries: config.retryCount, gapMs: config.requestGapMs });
    } catch (error) {
      rows.push({ symbol, capturedAt: new Date(serverTime * 1000).toISOString(), error: error.message });
    }
    if (book) {
      const row = { symbol, capturedAt: new Date(serverTime * 1000).toISOString(), bestBid: book.bestBid, bestAsk: book.bestAsk, spread: book.spread, bids: book.bids, asks: book.asks };
      try { Object.assign(row, measuredCosts(book, config.orderSize)); }
      catch (error) { row.costSampleError = error.message; }
      rows.push(row);
    }
    await new Promise(resolve => setTimeout(resolve, config.requestGapMs));
  }
  fs.appendFileSync(output, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  console.log(`Snapshot ditulis: ${rows.length} pasangan, ${new Date(serverTime * 1000).toISOString()}`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });