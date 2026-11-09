'use strict';

const { matchesSecret } = require('../lib/auth.cjs');
const storage = require('../lib/storage.cjs');

module.exports = async function killSwitch(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  if (!matchesSecret(String(req.headers['x-kill-secret'] || ''), process.env.KILL_SWITCH_SECRET)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'body_must_include_boolean_enabled' });
    return;
  }
  try {
    await storage.setKillSwitch(enabled);
    const event = { time: new Date().toISOString(), enabled, source: 'manual_endpoint' };
    await storage.append('switches', event);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(event);
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
};