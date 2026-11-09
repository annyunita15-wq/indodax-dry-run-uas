'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAuditMetrics } = require('./audit.cjs');

const config = { capital: 100, intervalSeconds: 100, freezeAt: '1970-01-01T00:16:40Z', forwardEnd: '1970-01-01T00:21:40Z' };

test('does not report forward returns when there is no equity log', () => {
  const result = buildAuditMetrics({ calls: [], trades: [] }, config);
  assert.equal(result.forward.returnTotal, null);
  assert.equal(result.expectedTicks, 3);
});

test('derives uptime, forward equity, and signal match from raw audit logs', () => {
  const freeze = Date.parse(config.freezeAt) / 1000;
  const time = freeze + 100;
  const result = buildAuditMetrics({
    state: { equityDaily: [{ time, equity: 95 }] },
    calls: [{ time, deadlineAt: new Date((time + 100) * 1000).toISOString(), markedEquity: 95, decisions: [{ symbol: 'BTCIDR', candleTime: 123, action: 'BUY' }] }],
    trades: [], errors: [], switches: [], backtest: { initialCapital: 100 },
    forwardReplay: { signals: [{ symbol: 'BTCIDR', candleTime: 123, action: 'BUY' }], metrics: { returnTotal: 0 } }
  }, config);
  assert.equal(result.processedTicks, 1);
  assert.ok(Math.abs(result.forward.returnTotal + 0.05) < 1e-12);
  assert.equal(result.signalMatchRate, 1);
});