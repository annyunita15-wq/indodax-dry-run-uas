'use strict';

function sweep(levels, side, quoteBudget, quantity) {
  let filledBase = 0;
  let filledQuote = 0;
  for (const level of levels) {
    const remaining = side === 'BUY' ? quoteBudget - filledQuote : quantity - filledBase;
    if (remaining <= 1e-10) break;
    const takeBase = side === 'BUY' ? Math.min(level.volume, remaining / level.price) : Math.min(level.volume, remaining);
    filledBase += takeBase;
    filledQuote += takeBase * level.price;
  }
  return {
    quantity: filledBase,
    quote: filledQuote,
    averagePrice: filledBase ? filledQuote / filledBase : null,
    complete: side === 'BUY' ? filledQuote >= quoteBudget * 0.999999 : filledBase >= quantity * 0.999999
  };
}

function measuredCosts(book, quoteNotional) {
  if (!book.valid) throw new Error('order_book_spread_over_2pct');
  const buy = sweep(book.asks, 'BUY', quoteNotional);
  const sell = sweep(book.bids, 'SELL', undefined, buy.quantity);
  if (!buy.complete || !sell.complete) throw new Error('insufficient_depth_for_cost_sample');
  return {
    spread: book.spread,
    buySlippage: Math.max(0, buy.averagePrice / book.bestAsk - 1),
    sellSlippage: Math.max(0, 1 - sell.averagePrice / book.bestBid),
    sampledAt: new Date().toISOString()
  };
}

function roundDown(value, increment) {
  const step = Number(increment);
  return Number.isFinite(step) && step > 0 ? Math.floor((value + step * 1e-9) / step) * step : value;
}

function feeRate(pair, officialFeePercent, side = 'BUY') {
  const apiRaw = pair?.trade_fee_percent_taker;
  const officialRaw = typeof officialFeePercent === 'object' && officialFeePercent !== null
    ? officialFeePercent[side.toLowerCase()]
    : officialFeePercent;
  const apiPercent = Number(apiRaw);
  const officialPercent = Number(officialRaw);
  if (apiRaw == null || officialRaw == null || String(apiRaw).trim() === '' || String(officialRaw).trim() === '' ||
      !Number.isFinite(apiPercent) || !Number.isFinite(officialPercent) || apiPercent < 0 || officialPercent < 0) {
    throw new Error('taker_fee_source_missing_or_invalid');
  }
  return Math.max(apiPercent, officialPercent) / 100;
}

function executeBuy(book, quoteBudget, rate, pair = {}) {
  if (!Number.isFinite(Number(pair.quantity_increment)) || Number(pair.quantity_increment) <= 0) throw new Error('invalid_quantity_increment');
  const fill = sweep(book.asks, 'BUY', quoteBudget);
  if (!fill.quantity || fill.quote < 25_000) throw new Error('buy_below_minimum_or_no_depth');
  const quantity = roundDown(fill.quantity, pair.quantity_increment);
  const quote = quantity * fill.averagePrice;
  if (!quantity || quote < 25_000) throw new Error('buy_below_minimum_or_quantity_increment');
  const fee = quote * rate;
  return { ...fill, quantity, quote, fee, totalCost: quote + fee, bestBid: book.bestBid, bestAsk: book.bestAsk };
}

function executeSell(book, quantity, rate, pair = {}) {
  if (!Number.isFinite(Number(pair.quantity_increment)) || Number(pair.quantity_increment) <= 0) throw new Error('invalid_quantity_increment');
  const orderQuantity = roundDown(quantity, pair.quantity_increment);
  const fill = sweep(book.bids, 'SELL', undefined, orderQuantity);
  if (!fill.quantity || fill.quantity < orderQuantity * 0.999999) throw new Error('insufficient_bid_depth');
  const fee = fill.quote * rate;
  return { ...fill, fee, proceeds: fill.quote - fee, bestBid: book.bestBid, bestAsk: book.bestAsk };
}

module.exports = { sweep, measuredCosts, roundDown, feeRate, executeBuy, executeSell };