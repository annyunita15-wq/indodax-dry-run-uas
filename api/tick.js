'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const defaults = require('../config.cjs');
const { matchesSecret } = require('../lib/auth.cjs');
const { getHistory, getDepth, getPairs, getServerTime } = require('../lib/indodax.cjs');
const { measuredCosts } = require('../lib/execution.cjs');
const { validateBars } = require('../lib/strategy.cjs');
const { createState, runTick } = require('../lib/tick-engine.cjs');
const storage = require('../lib/storage.cjs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function runtimeConfig() {
  const file = path.join(process.cwd(), 'data', 'runtime-config.json');
  if (!fs.existsSync(file)) throw new Error('runtime_config_missing_run_scripts_create-runtime-config.cjs');
  const selected = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(selected.symbols) || selected.symbols.length < 3 || selected.symbols.length > 10) throw new Error('universe_must_contain_3_to_10_symbols');
  return { ...defaults, ...selected, params: { ...defaults.params, ...selected.params } };
}

module.exports = async function tick(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!matchesSecret(token, process.env.CRON_SECRET)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (process.env.BOT_ENABLED !== 'true' || !/^[a-f0-9]{7,40}$/i.test(process.env.FREEZE_COMMIT || '') ||
      process.env.OFFICIAL_TAKER_FEE_PERCENT == null || process.env.OFFICIAL_TAKER_FEE_PERCENT.trim() === '' ||
      !Number.isFinite(Number(process.env.OFFICIAL_TAKER_FEE_PERCENT))) {
    res.status(423).json({ error: 'bot_disabled_or_freeze_commit_missing' });
    return;
  }

  const started = Date.now();
  const lockToken = randomUUID();
  let locked = false;
  let latestClosedTime = null;
  try {
    locked = await storage.acquireLock(lockToken);
    if (!locked) {
      const finishedAt = new Date().toISOString();
      await storage.append('calls', { time: Math.floor(Date.now() / 1000), startedAt: new Date(started).toISOString(), finishedAt, elapsedMs: Date.now() - started, processedCandles: 0, decisions: [], errors: [{ reason: 'tick_already_running' }] });
      res.status(409).json({ error: 'tick_already_running' });
      return;
    }

    const config = runtimeConfig();
    const serverTime = await getServerTime({ retries: defaults.retryCount, gapMs: defaults.requestGapMs });
    const pairMap = await getPairs({ retries: defaults.retryCount, gapMs: defaults.requestGapMs });
    const markets = [];
    const snapshots = [];
    for (const symbol of config.symbols) {
      const market = { symbol, errors: [] };
      try {
        const from = serverTime - config.intervalSeconds * config.historyBars;
        const bars = await getHistory(symbol, from, serverTime, { retries: config.retryCount, gapMs: config.requestGapMs });
        market.validation = validateBars(bars, serverTime, config.intervalSeconds, config.minimumBars);
        if (!market.validation.ok) throw new Error(market.validation.reason);
        market.signalBars = market.validation.bars;
        latestClosedTime = Math.max(latestClosedTime || 0, market.signalBars.at(-1).time);
      } catch (error) {
        market.errors.push(error.message);
        market.validation = { ok: false, reason: error.message };
      }
      try {
        market.book = await getDepth(symbol, { retries: config.retryCount, gapMs: config.requestGapMs });
        market.pair = pairMap.get(symbol);
        if (!market.pair) throw new Error('pair_not_available');
        const snapshot = {
          symbol,
          capturedAt: new Date(serverTime * 1000).toISOString(),
          bestBid: market.book.bestBid,
          bestAsk: market.book.bestAsk,
          spread: market.book.spread,
          bids: market.book.bids,
          asks: market.book.asks
        };
        try { Object.assign(snapshot, measuredCosts(market.book, config.orderSize)); }
        catch (error) { snapshot.costSampleError = error.message; }
        market.snapshot = snapshot;
        snapshots.push(snapshot);
        if (!market.book.valid) market.errors.push('order_book_spread_over_2pct');
      } catch (error) {
        market.errors.push(error.message);
      }
      if (market.errors.length) market.validation = { ok: false, reason: market.errors.join(';') };
      markets.push(market);
      await sleep(config.requestGapMs);
    }

    const killSwitch = await storage.getKillSwitch();
    const state = await storage.getState() || createState(config);
    const result = runTick(state, markets, { timestamp: serverTime, officialFeePercent: process.env.OFFICIAL_TAKER_FEE_PERCENT, killSwitch, config });
    result.call.startedAt = new Date(started).toISOString();
    result.call.finishedAt = new Date().toISOString();
    result.call.elapsedMs = Date.now() - started;
    result.call.serverTime = serverTime;
    result.call.scheduledAt = latestClosedTime == null ? null : new Date((latestClosedTime + config.intervalSeconds + 7 * 60) * 1000).toISOString();
    result.call.deadlineAt = latestClosedTime == null ? null : new Date((latestClosedTime + config.intervalSeconds * 2) * 1000).toISOString();
    result.call.apiErrors = markets.flatMap(market => market.errors.map(reason => ({ symbol: market.symbol, reason })));
    await storage.setState(result.state);
    await storage.append('calls', result.call);
    for (const row of result.orders) await storage.append('orders', row);
    for (const row of result.trades) await storage.append('trades', row);
    for (const row of result.snapshots) await storage.append('snapshots', row);
    for (const row of result.call.apiErrors) await storage.append('errors', { time: result.call.finishedAt, ...row });
    res.status(200).json({ ok: true, call: result.call, orders: result.orders.length, errors: result.call.apiErrors.length });
  } catch (error) {
    const finishedAt = new Date().toISOString();
    try {
      await storage.append('calls', { time: Math.floor(Date.now() / 1000), startedAt: new Date(started).toISOString(), finishedAt, elapsedMs: Date.now() - started, processedCandles: 0, decisions: [], errors: [{ reason: error.message }] });
      await storage.append('errors', { time: finishedAt, endpoint: 'tick', reason: error.message });
    } catch {}
    res.status(502).json({ error: error.message });
  } finally {
    if (locked) {
      try { await storage.releaseLock(lockToken); } catch {}
    }
  }
};