'use strict';

const prefix = 'indodax-dry-run-uas';

async function redis(parts) {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('storage_not_configured');
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(parts),
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`storage_http_${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`storage_error_${payload.error}`);
  return payload.result;
}

async function getState() {
  const value = await redis(['GET', `${prefix}:state`]);
  return value ? JSON.parse(value) : null;
}

async function setState(state) {
  await redis(['SET', `${prefix}:state`, JSON.stringify(state)]);
}

async function acquireLock(value, seconds = 360) {
  return (await redis(['SET', `${prefix}:tick-lock`, value, 'NX', 'EX', String(seconds)])) === 'OK';
}

async function releaseLock(value) {
  await redis(['EVAL', "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end", '1', `${prefix}:tick-lock`, value]);
}

async function append(name, value) {
  await redis(['RPUSH', `${prefix}:${name}`, JSON.stringify(value)]);
}

async function readList(name) {
  const values = await redis(['LRANGE', `${prefix}:${name}`, '0', '-1']);
  return (values || []).map(value => JSON.parse(value));
}

async function getKillSwitch() {
  return (await redis(['GET', `${prefix}:kill-switch`])) === '1';
}

async function setKillSwitch(enabled) {
  await redis(['SET', `${prefix}:kill-switch`, enabled ? '1' : '0']);
}

module.exports = { getState, setState, acquireLock, releaseLock, append, readList, getKillSwitch, setKillSwitch };