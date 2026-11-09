'use strict';

const { performance } = require('./report.cjs');

function buildAuditMetrics(audit, config) {
  const state = audit.state || {};
  const calls = audit.calls || [];
  const trades = audit.trades || [];
  const errors = audit.errors || [];
  const switches = audit.switches || [];
  const backtest = audit.backtest || null;
  const freeze = Math.floor(Date.parse(config.freezeAt) / 1000);
  const forwardEnd = Math.floor(Date.parse(config.forwardEnd) / 1000);
  const expectedTicks = Math.round((forwardEnd - freeze) / config.intervalSeconds);
  const processed = new Set();
  const observedSignals = new Map();

  for (const call of calls) {
    const callTime = Number(call.time);
    const hasWork = (call.decisions || []).some(decision => decision.action !== 'DUPLICATE_IGNORED');
    const deadline = Date.parse(call.deadlineAt || '') / 1000;
    if (callTime >= freeze && callTime < forwardEnd && hasWork && Number.isFinite(deadline) && callTime <= deadline) {
      processed.add(Math.floor(callTime / config.intervalSeconds) * config.intervalSeconds);
    }
    if (callTime < freeze || callTime >= forwardEnd) continue;
    for (const decision of call.decisions || []) {
      if (decision.action !== 'DUPLICATE_IGNORED' && decision.candleTime != null) {
        observedSignals.set(`${decision.symbol}|${decision.candleTime}`, decision.action);
      }
    }
  }

  const forwardPoints = (state.equityDaily || []).filter(row => Number(row.time) >= freeze && Number(row.time) <= forwardEnd)
    .map(row => [Number(row.time), Number(row.equity)]);
  const lastForwardCall = [...calls].reverse().find(call => Number(call.time) >= freeze && Number(call.time) < forwardEnd && Number.isFinite(call.markedEquity));
  if (lastForwardCall && !forwardPoints.some(row => row[0] === Number(lastForwardCall.time))) {
    forwardPoints.push([Number(lastForwardCall.time), Number(lastForwardCall.markedEquity)]);
  }
  forwardPoints.sort((a, b) => a[0] - b[0]);
  const startingCapital = Number(backtest?.initialCapital || config.capital);
  const forwardEquity = [[freeze, startingCapital], ...forwardPoints];
  const forward = forwardPoints.length
    ? performance(forwardEquity, trades, startingCapital, null)
    : { returnTotal: null, cagr: null, maxDrawdown: null, count: trades.length, profitFactor: null, winRate: null, averageWin: null, averageLoss: null, costShare: null };

  const replay = audit.forwardReplay || null;
  let signalMatched = 0;
  let signalCompared = 0;
  for (const signal of replay?.signals || []) {
    const key = `${signal.symbol}|${signal.candleTime}`;
    if (!observedSignals.has(key)) continue;
    signalCompared++;
    if (observedSignals.get(key) === signal.action) signalMatched++;
  }

  return {
    builtAt: new Date().toISOString(),
    backtest: backtest?.metrics || null,
    backtestWindow: backtest?.period || null,
    forward,
    forwardDailyEquity: forwardPoints,
    expectedTicks,
    processedTicks: processed.size,
    timelyTicks: processed.size,
    uptime: expectedTicks ? processed.size / expectedTicks : null,
    signalMatched,
    signalCompared,
    signalMatchRate: signalCompared ? signalMatched / signalCompared : null,
    apiErrors: errors.length,
    killSwitchUses: switches.filter(event => event.enabled).length,
    forwardReplay: replay,
    backtestForwardGap: replay?.metrics?.returnTotal == null || forward.returnTotal == null
      ? null
      : forward.returnTotal - replay.metrics.returnTotal,
    benchmark: audit.benchmark || backtest?.benchmark || replay?.benchmark || null,
    tradeCount: trades.length
  };
}

module.exports = { buildAuditMetrics };