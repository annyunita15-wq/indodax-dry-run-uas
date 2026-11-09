'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('../config.cjs');

const root = path.join(__dirname, '..');
const candles = JSON.parse(fs.readFileSync(path.join(root, 'data', 'candles.json'), 'utf8'));
const start = Math.floor(Date.parse(process.env.BACKTEST_START || config.backtestStart) / 1000);
const end = start + 30 * 24 * 60 * 60;
const required = 30 * 24 * 60 * 60 / config.intervalSeconds * 0.95;
const ranked = [];

for (const symbol of config.candidateSymbols) {
  const bars = candles.data[symbol];
  if (!Array.isArray(bars)) continue;
  const window = bars.filter(bar => bar.time >= start && bar.time < end);
  if (window.length < required) continue;
  const daily = new Map();
  for (const bar of window) {
    const day = new Date(bar.time * 1000).toISOString().slice(0, 10);
    daily.set(day, (daily.get(day) || 0) + bar.close * bar.volume);
  }
  ranked.push({ symbol, bars: window.length, days: daily.size, averageDailyTurnoverIdr: [...daily.values()].reduce((sum, value) => sum + value, 0) / daily.size });
}

ranked.sort((a, b) => b.averageDailyTurnoverIdr - a.averageDailyTurnoverIdr || a.symbol.localeCompare(b.symbol));
if (ranked.length < 3) throw new Error(`Hanya ${ranked.length} pasangan memiliki data awal yang cukup; perlu minimal 3.`);
const universe = {
  selectedAt: new Date().toISOString(),
  selectionWindow: { start: new Date(start * 1000).toISOString(), end: new Date(end * 1000).toISOString() },
  rule: 'Top 5 kandidat berdasarkan rata-rata turnover harian IDR pada 30 hari pertama jendela backtest; hanya pasangan dengan >=95% candle tersedia.',
  candidates: ranked,
  symbols: ranked.slice(0, 5).map(row => row.symbol),
  survivorshipNote: 'Seleksi memakai kandidat pasangan yang ada di API saat ini. Pasangan yang sudah delisting tidak dapat ditemukan dari API saat ini; sertakan arsip listing historis untuk menghapus bias itu.'
};
fs.writeFileSync(path.join(root, 'data', 'universe.json'), JSON.stringify(universe, null, 2));
console.log(`Terpilih: ${universe.symbols.join(', ')}`);