# Late Freeze Record

## Status

This is a late code/configuration checkpoint. Its actual commit timestamp is the timestamp recorded by Git; it is not backdated and does not prove that the original freeze happened on time.

The UAS schedule specified a freeze on 4 November 2026 at 12.00 WIB and a forward test through 14 November 2026 at 12.00 WIB. This workspace has no Git history from that date, no Vercel deployment logs, and no order-book snapshots from before that freeze. Those events cannot be reconstructed honestly.

## Frozen implementation inputs

- Timeframe: 4 hours.
- Strategy: Bollinger Bands (25, population standard deviation 2) with Wilder RSI (10); entry RSI below 30; exit RSI above 60 or close crossing above the BB mean.
- Universe: `USDTIDR`, `BTCIDR`, `ETHIDR`, `XRPIDR`, and `SOLIDR`, selected by turnover during the first 30 days of the historical window. See `data/universe.json`.
- Risk rules: virtual capital Rp100,000,000; initial order Rp10,000,000; maximum Rp20,000,000 per pair; at most 5 positions; daily loss limit 2%; long-only.
- Runtime selection and parameters: `data/runtime-config.json` and `config.cjs`.

## Evidence gaps

- The original freeze-date order-book snapshots are absent. The snapshot file contains observations captured after the original freeze and cannot be used as if they were pre-freeze measurements.
- The public pairs API reported a 0.2% taker fee on 9 November 2026. The official fee page referenced in the assignment returned HTTP 404 when checked, so the second fee source is not verified. No official fee value is inferred or fabricated.
- The three-year candle history and initial-liquidity universe exist, but the cost-aware backtest intentionally refuses to produce results until valid fee records and eligible snapshots are supplied.
- No Vercel forward run has been started. The required ten-day forward results, uptime, and signal comparison therefore do not exist.

Do not present this late checkpoint as proof of the original freeze or as completed forward-test evidence. Request approval for late submission or a new ten-day test window from the instructor.