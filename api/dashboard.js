'use strict';

const fs = require('node:fs');
const path = require('node:path');
const config = require('../config.cjs');
const { buildAuditMetrics } = require('../lib/audit.cjs');
const storage = require('../lib/storage.cjs');

module.exports = async function dashboard(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  try {
    const storageConfigured = Boolean(
      (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) &&
      (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)
    );
    if (!storageConfigured) {
      const backtestPath = path.join(process.cwd(), 'data', 'backtest.json');
      const backtest = fs.existsSync(backtestPath) ? JSON.parse(fs.readFileSync(backtestPath, 'utf8')) : null;
      const audit = { state: null, calls: [], orders: [], trades: [], snapshots: [], errors: [], switches: [], backtest, forwardReplay: null };
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json({ ...audit, storageConfigured, metrics: buildAuditMetrics(audit, config) });
      return;
    }
    const [state, calls, orders, trades, snapshots, errors, switches] = await Promise.all([
      storage.getState(), storage.readList('calls'), storage.readList('orders'), storage.readList('trades'),
      storage.readList('snapshots'), storage.readList('errors'), storage.readList('switches')
    ]);
    res.setHeader('Cache-Control', 'no-store');
    const backtestPath = path.join(process.cwd(), 'data', 'backtest.json');
    const backtest = fs.existsSync(backtestPath) ? JSON.parse(fs.readFileSync(backtestPath, 'utf8')) : null;
    const replayPath = path.join(process.cwd(), 'data', 'forward-replay.json');
    const forwardReplay = fs.existsSync(replayPath) ? JSON.parse(fs.readFileSync(replayPath, 'utf8')) : null;
    const audit = { state, calls, orders, trades, snapshots, errors, switches, backtest, forwardReplay };
    res.status(200).json({ ...audit, storageConfigured, metrics: buildAuditMetrics(audit, config) });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
};