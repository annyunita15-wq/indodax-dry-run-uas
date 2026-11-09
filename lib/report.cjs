'use strict';

function maxDrawdown(equity) {
  let peak = -Infinity;
  let drawdown = 0;
  for (const point of equity) {
    const value = Number(Array.isArray(point) ? point[1] : point.equity);
    peak = Math.max(peak, value);
    if (peak > 0) drawdown = Math.min(drawdown, value / peak - 1);
  }
  return drawdown;
}

function tradeMetrics(trades) {
  const wins = trades.filter(trade => trade.pnl > 0);
  const losses = trades.filter(trade => trade.pnl < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = -losses.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossPositive = trades.reduce((sum, trade) => sum + Math.max(0, trade.grossPnl || 0), 0);
  const costs = trades.reduce((sum, trade) => sum + (trade.costs || 0), 0);
  return {
    count: trades.length,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? null : 0,
    winRate: trades.length ? wins.length / trades.length : null,
    averageWin: wins.length ? grossProfit / wins.length : null,
    averageLoss: losses.length ? losses.reduce((sum, trade) => sum + trade.pnl, 0) / losses.length : null,
    costShare: grossPositive ? costs / grossPositive : null
  };
}

function performance(equity, trades, startingCapital, elapsedYears = null) {
  if (!equity.length) return { returnTotal: null, cagr: null, maxDrawdown: null, ...tradeMetrics(trades) };
  const first = Number(Array.isArray(equity[0]) ? equity[0][1] : equity[0].equity);
  const last = Number(Array.isArray(equity[equity.length - 1]) ? equity[equity.length - 1][1] : equity[equity.length - 1].equity);
  const years = elapsedYears ?? ((Number(Array.isArray(equity.at(-1)) ? equity.at(-1)[0] : equity.at(-1).time) - Number(Array.isArray(equity[0]) ? equity[0][0] : equity[0].time)) / (365.25 * 86400));
  return {
    returnTotal: last / startingCapital - 1,
    cagr: years > 0 && last > 0 ? Math.pow(last / startingCapital, 1 / years) - 1 : null,
    maxDrawdown: maxDrawdown(equity),
    ...tradeMetrics(trades)
  };
}

module.exports = { maxDrawdown, tradeMetrics, performance };