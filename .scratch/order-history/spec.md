# Order history and account info

Status: ready-for-agent (agreed in a grilling session, 2026-10-24)

## Goal
The Trade area shows only what is open right now: the USDT wallet, positions of the selected asset, open orders and the last 30 fills of that asset.
Add a way to look back: every order with its final status, every fill, income (realised PnL, funding, commissions) and the full account picture (all balances, margin and position mode, fee rates, key permissions), for all three accounts.

## Decisions (grilling answers)
1. **All three accounts**: simulated paper, Binance demo, Binance live, one screen. The simulated broker keeps a full history of its own.
2. **Binance data shown**:
   - Account info: every asset balance (not only USDT), margin mode, position mode (one-way / hedge), leverage per position, fee rates, whether the key allows trading.
   - Order history: all orders with final status (filled, cancelled, expired), type, price, size.
   - Fills: every fill with fee and realised PnL.
   - Income: realised PnL, funding payments, commissions, transfers, with totals for the chosen period.
3. **Symbols**: Binance returns orders and fills one symbol at a time. Default is the header asset; a symbol picker; and the symbols found in the income history are offered as quick picks.
4. **Where**: Trade area, two new views beside Trading and Accounts: **History** (Orders / Fills / Income as three tabs) and **Account info**. Trading and Accounts stay as they are (their Recent fills panel is not touched).
5. **Safety and limits**: read-only (GET only, never an order or cancel call). Keys stay in page memory only, as today. Data loads when the view opens and on a Refresh button, not on a fast timer. A "Download CSV" button saves what is on screen, only when pressed.
6. **Scope**: USD-M futures only. No spot, margin, wallet transfers or coin-margined futures.

## Rules
- Nothing existing is removed. Reader engine, episode layer and feeds untouched. The paper broker is touched only to record history; its fills, positions and fees must come out exactly as today.
- Display only: the history never feeds a detection.
- One step per release (`node build.mjs --release`). Test at 390px and at desktop width. Real-money mode: reads only, so no extra confirmation, but never log or show keys.

## Facts checked
- `fapi.binance.com` and `demo-fapi.binance.com` both answer CORS preflights for the `x-mbx-apikey` header from any origin (checked 2026-10-24 with the Pages origin), so signed GETs from the hosted page can work. Not yet tried with real keys.

## Data (verify each against Binance's USD-M futures docs at build time; fix this list if they differ)
- Account info: `GET /fapi/v2/balance` (all assets), `GET /fapi/v2/account` (can trade, fee tier, multi-assets mode), `GET /fapi/v2/positionRisk` (leverage, margin type per position), `GET /fapi/v1/positionSide/dual` (hedge or one-way), `GET /fapi/v1/commissionRate?symbol=`.
- Orders: `GET /fapi/v1/allOrders` (symbol required, up to 1000, a time window is limited to 7 days per request).
- Fills: `GET /fapi/v1/userTrades` (symbol required, up to 1000, 7-day window per request).
- Income: `GET /fapi/v1/income` (all symbols, optional type filter, history is limited to about 3 months).
- Longer periods are fetched in 7-day pieces, newest first, with a visible progress line and a stop button; stay well under the request-weight limit (2400 per minute) and show Binance's error text if it refuses.
- Does the demo environment support every endpoint above? Unknown; a call that fails shows its message and the rest still render.

## Common shape (pure core, `src/js/history-core.js`, self-tested)
One normaliser per source turns Binance payloads and simulated records into the same rows, so the views do not care where they came from.
- Order: `{id, t, symbol, side, type, price, qty, filled, avg, status, reduce}`
- Fill: `{id, t, symbol, side, price, qty, fee, feeAsset, pnl, maker}`
- Income: `{t, symbol, type, amount, asset}` with `totals(rows, from, to)` by type
- Account: `{assets:[{asset, wallet, available, upnl}], positions:[{symbol, qty, entry, mark, lev, marginType, liq}], mode:{hedge, multiAssets}, canTrade, feeTier, fees:{maker, taker}}`
- `toCsv(rows, columns)`.
Self-test scenarios with sample Binance payloads (including odd values: empty strings, zero-quantity positions, statuses) and sample simulated records.

## Simulated broker
Today `SIM.fills` keeps the last 50 and orders vanish when filled or cancelled. Add: `SIM.log.orders` (every order with its final status and time), `SIM.log.fills` (every fill, capped at a few thousand), `SIM.log.income` (fees and realised PnL as rows). The existing arrays and numbers (cash, positions, fee maths) must not change; check with the same orders before and after. History is lost on reload like the rest of the simulated account.

## Steps (each its own release)
1. **Core and simulated history.** `history-core.js` with normalisers, totals, CSV and self-tests; the paper broker records its log. No new screen yet.
2. **Account info view.** Trade > Account info: balances, positions with leverage and margin type, modes, fee rates, permissions. Refresh button; error line per failed call.
3. **History view.** Trade > History: Orders / Fills / Income tabs, symbol picker with quick picks, period (1 day, 7 days, 30 days, 90 days), totals for the period, Refresh, Download CSV.

## Out of scope
- Spot, margin, transfers, coin-margined futures; placing or cancelling from these views; automatic background syncing; saving history to disk or IndexedDB (a later step if wanted).

## Open for the build
- Which fee-rate endpoint and wallet fields the demo environment really returns.
- Paging behaviour when a 7-day piece returns exactly 1000 rows (fetch the rest by id).
- Time zone of displayed times (follow the rest of the app: local).
