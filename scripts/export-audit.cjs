'use strict';

const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const url = process.env.DASHBOARD_URL;
  if (!url) throw new Error('Set DASHBOARD_URL ke URL publik /api/dashboard.');
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Dashboard API HTTP ${response.status}`);
  const audit = await response.json();
  const dataDir = path.join(__dirname, '..', 'data');
  const backtestPath = path.join(dataDir, 'backtest.json');
  if (!audit.backtest && fs.existsSync(backtestPath)) audit.backtest = JSON.parse(fs.readFileSync(backtestPath, 'utf8'));
  const replayPath = path.join(dataDir, 'forward-replay.json');
  if (fs.existsSync(replayPath)) audit.forwardReplay = JSON.parse(fs.readFileSync(replayPath, 'utf8'));
  const candlePath = path.join(dataDir, 'candles.json');
  if (fs.existsSync(candlePath)) {
    const config = require('../config.cjs');
    const candles = JSON.parse(fs.readFileSync(candlePath, 'utf8')).data.BTCIDR || [];
    const range = (start, end) => {
      const config = require('../config.cjs');
      const bars = candles.filter(bar => bar.time + config.intervalSeconds > start && bar.time + config.intervalSeconds <= end);
      return bars.length > 1 ? { returnTotal: bars.at(-1).close / bars[0].close - 1, start: bars[0].time, end: bars.at(-1).time } : null;
    };
    audit.benchmark = {
      symbol: 'BTCIDR',
      full: range(Date.parse(config.backtestStart) / 1000, Date.parse(config.freezeAt) / 1000),
      forward: range(Date.parse(config.freezeAt) / 1000, Date.parse(config.forwardEnd) / 1000)
    };
  }
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'audit-export.json'), JSON.stringify(audit));
  console.log(`Ekspor audit disimpan: ${audit.calls?.length || 0} panggilan, ${audit.orders?.length || 0} order, ${audit.snapshots?.length || 0} snapshot.`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });