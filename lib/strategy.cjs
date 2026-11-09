'use strict';

function closedBars(bars, serverTime, intervalSeconds) {
  return bars.filter(bar => Number(bar.time) + intervalSeconds <= serverTime);
}

function validateBars(bars, serverTime, intervalSeconds, requiredBars) {
  const closed = closedBars(bars, serverTime, intervalSeconds);
  if (closed.length < requiredBars) return { ok: false, reason: 'insufficient_history', bars: closed };
  const latest = closed[closed.length - 1];
  if (serverTime - (latest.time + intervalSeconds) > intervalSeconds * 2) {
    return { ok: false, reason: 'stale_candle', bars: closed };
  }
  for (let index = 0; index < closed.length; index++) {
    const bar = closed[index];
    if (![bar.open, bar.high, bar.low, bar.close, bar.volume].every(Number.isFinite) ||
        [bar.open, bar.high, bar.low, bar.close].some(value => value <= 0) || bar.volume <= 0) {
      return { ok: false, reason: 'invalid_ohlcv', bars: closed };
    }
    if (index && bar.time - closed[index - 1].time !== intervalSeconds) {
      return { ok: false, reason: 'missing_candle', bars: closed };
    }
  }
  return { ok: true, reason: null, bars: closed };
}

function rsiWilder(closes, period) {
  if (closes.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= period; index++) {
    const change = closes[index] - closes[index - 1];
    gain += Math.max(change, 0) / period;
    loss += Math.max(-change, 0) / period;
  }
  for (let index = period + 1; index < closes.length; index++) {
    const change = closes[index] - closes[index - 1];
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
  }
  return loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}

function mean(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function evaluateSignal(bars, params, hasPosition = false) {
  const needed = Math.max(params.bb + 1, params.rsi + 1);
  if (bars.length < needed) throw new Error('insufficient_history');
  const closes = bars.map(bar => bar.close);
  const currentWindow = closes.slice(-params.bb);
  const previousWindow = closes.slice(-params.bb - 1, -1);
  const currentMean = mean(currentWindow);
  const variance = mean(currentWindow.map(close => (close - currentMean) ** 2));
  const lower = currentMean - params.sd * Math.sqrt(variance);
  const previousMean = mean(previousWindow);
  const current = bars[bars.length - 1];
  const previous = bars[bars.length - 2];
  const rsi = rsiWilder(closes, params.rsi);
  const buy = (current.low <= lower || current.close < lower) && rsi < params.os;
  const sell = (current.close > currentMean && previous.close <= previousMean) || rsi > params.xr;
  return {
    action: hasPosition ? (sell ? 'SELL' : 'HOLD') : (buy ? 'BUY' : 'FLAT'),
    close: current.close,
    lower,
    mean: currentMean,
    rsi
  };
}

module.exports = { closedBars, validateBars, rsiWilder, evaluateSignal };