'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('../config.cjs');

const root = path.join(__dirname, '..');
const universe = JSON.parse(fs.readFileSync(path.join(root, 'data', 'universe.json'), 'utf8'));
if (!Array.isArray(universe.symbols) || universe.symbols.length < 3 || universe.symbols.length > 10) {
  throw new Error('Universe belum memuat 3–10 pasangan terpilih. Jalankan select-universe.cjs terlebih dahulu.');
}
const runtime = {
  symbols: universe.symbols,
  params: config.params,
  timeframe: config.timeframe,
  intervalSeconds: config.intervalSeconds,
  freezeAt: config.freezeAt,
  capital: config.capital,
  orderSize: config.orderSize,
  maxPositionValue: config.maxPositionValue,
  maxPositions: config.maxPositions,
  dailyLossLimit: config.dailyLossLimit,
  generatedAt: new Date().toISOString(),
  universeSelectionWindow: universe.selectionWindow
};
fs.writeFileSync(path.join(root, 'data', 'runtime-config.json'), JSON.stringify(runtime, null, 2));
console.log(`Runtime config dibuat untuk ${runtime.symbols.join(', ')}; beku dan commit file ini sebelum forward test.`);