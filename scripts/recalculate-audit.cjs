'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('../config.cjs');
const { buildAuditMetrics } = require('../lib/audit.cjs');

const root = path.join(__dirname, '..');
const audit = JSON.parse(fs.readFileSync(path.join(root, 'data', 'audit-export.json'), 'utf8'));
if (!audit.backtest) audit.backtest = JSON.parse(fs.readFileSync(path.join(root, 'data', 'backtest.json'), 'utf8'));
if (!audit.forwardReplay && fs.existsSync(path.join(root, 'data', 'forward-replay.json'))) {
  audit.forwardReplay = JSON.parse(fs.readFileSync(path.join(root, 'data', 'forward-replay.json'), 'utf8'));
}
const metrics = buildAuditMetrics(audit, config);
fs.writeFileSync(path.join(root, 'data', 'recalculated.json'), JSON.stringify(metrics, null, 2));
console.log(`Hitung ulang: ${metrics.processedTicks}/${metrics.expectedTicks} candle; ${metrics.tradeCount} trade; uptime ${metrics.uptime == null ? '--' : (100 * metrics.uptime).toFixed(1) + '%'}.`);