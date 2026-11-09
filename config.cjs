'use strict';

module.exports = Object.freeze({
  timeframe: '240',
  intervalSeconds: 4 * 60 * 60,
  params: Object.freeze({ bb: 25, sd: 2, rsi: 10, os: 30, xr: 60 }),
  capital: 100_000_000,
  orderSize: 10_000_000,
  maxPositionValue: 20_000_000,
  maxPositions: 5,
  dailyLossLimit: 0.02,
  maxSpread: 0.02,
  minimumOrder: 25_000,
  minimumBars: 65,
  historyBars: 80,
  retryCount: 2,
  requestGapMs: 350,
  backtestStart: '2023-11-04T00:00:00Z',
  freezeAt: '2026-11-04T05:00:00Z',
  forwardEnd: '2026-11-14T05:00:00Z',
  snapshotStart: '2026-11-02T00:00:00+07:00',
  candidateSymbols: Object.freeze([
    'BTCIDR', 'ETHIDR', 'XRPIDR', 'DOGEIDR', 'LTCIDR',
    'ADAIDR', 'TRXIDR', 'SOLIDR', 'BNBIDR', 'USDTIDR'
  ])
});