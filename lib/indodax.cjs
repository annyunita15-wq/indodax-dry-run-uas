'use strict';

const BASE = 'https://indodax.com';

function parseHistory(payload) {
  if (Array.isArray(payload)) {
    return payload.map(row => ({
      time: Number(row.Time),
      open: Number(row.Open),
      high: Number(row.High),
      low: Number(row.Low),
      close: Number(row.Close),
      volume: Number(row.Volume)
    })).sort((a, b) => a.time - b.time);
  }
  if (!payload || payload.s !== 'ok' || !Array.isArray(payload.t)) {
    throw new Error('invalid_history_response');
  }
  return payload.t.map((time, index) => ({
    time: Number(time),
    open: Number(payload.o?.[index]),
    high: Number(payload.h?.[index]),
    low: Number(payload.l?.[index]),
    close: Number(payload.c?.[index]),
    volume: Number(payload.v?.[index])
  })).sort((a, b) => a.time - b.time);
}

function parseDepth(payload) {
  const asks = (payload.sell || payload.asks || []).map(([price, volume]) => ({ price: Number(price), volume: Number(volume) }))
    .filter(level => level.price > 0 && level.volume > 0).sort((a, b) => a.price - b.price);
  const bids = (payload.buy || payload.bids || []).map(([price, volume]) => ({ price: Number(price), volume: Number(volume) }))
    .filter(level => level.price > 0 && level.volume > 0).sort((a, b) => b.price - a.price);
  if (!asks.length || !bids.length) throw new Error('empty_order_book');
  const bestAsk = asks[0].price;
  const bestBid = bids[0].price;
  const spread = (bestAsk - bestBid) / ((bestAsk + bestBid) / 2);
  return { asks, bids, bestAsk, bestBid, spread, valid: spread >= 0 && spread <= 0.02 };
}

function parsePairs(payload) {
  const rows = Array.isArray(payload) ? payload : Object.values(payload || {});
  return new Map(rows.filter(row => row && row.id).map(row => [String(row.id).toUpperCase(), row]));
}

function parseServerTime(payload) {
  const timestamp = Number(payload?.server_time || payload?.serverTime || payload?.time);
  if (!Number.isFinite(timestamp)) throw new Error('invalid_server_time');
  return Math.floor(timestamp > 1e12 ? timestamp / 1000 : timestamp);
}

function parsePriceIncrements(payload) {
  if (!payload?.increments || typeof payload.increments !== 'object') throw new Error('invalid_price_increments_response');
  return new Map(Object.entries(payload.increments).map(([pair, increment]) => [pair.toLowerCase(), Number(increment)]));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function requestJson(url, { retries = 2, gapMs = 350, fetchImpl = fetch } = {}) {
  let lastError;
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt) await sleep(gapMs * attempt);
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`indodax_http_${response.status}`);
      const value = await response.json();
      if (!value || typeof value !== 'object') throw new Error('empty_api_response');
      return value;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('indodax_request_failed');
}

async function getServerTime(options) {
  const data = await requestJson(`${BASE}/api/server_time`, options);
  return parseServerTime(data);
}

async function getHistory(symbol, from, to, options) {
  const url = `${BASE}/tradingview/history_v2?symbol=${encodeURIComponent(symbol.toLowerCase())}&tf=240&from=${from}&to=${to}`;
  return parseHistory(await requestJson(url, options));
}

async function getDepth(symbol, options) {
  return parseDepth(await requestJson(`${BASE}/api/depth/${symbol.toLowerCase()}`, options));
}

async function getPairs(options) {
  return parsePairs(await requestJson(`${BASE}/api/pairs`, options));
}

async function getPriceIncrements(options) {
  return parsePriceIncrements(await requestJson(`${BASE}/api/price_increments`, options));
}

module.exports = { BASE, parseHistory, parseDepth, parsePairs, parsePriceIncrements, parseServerTime, requestJson, getServerTime, getHistory, getDepth, getPairs, getPriceIncrements };