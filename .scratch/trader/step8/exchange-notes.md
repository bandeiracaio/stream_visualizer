# Step 8: exchange notes (Binance USD-M futures)

Read 2026-11-11 from developers.binance.com/docs/derivatives/usds-margined-futures (pages fetched through a summariser; where a page was cut off it is said below). Where the demo host disagrees, the demo host is the fact; that is checked in 8b and the result is added at the end.

## Found in the documentation

- **Conditional orders moved.** `POST /fapi/v1/algoOrder` (New Algo Order) takes `algoType=CONDITIONAL`, `type` STOP_MARKET / TAKE_PROFIT_MARKET / STOP / TAKE_PROFIT / TRAILING_STOP_MARKET, `triggerPrice`, `side`, `quantity`, `reduceOnly`, `clientAlgoId`. Error **-4120 STOP_ORDER_SWITCH_ALGO**: "order type not supported on this endpoint, use the Algo Order API". So a stop on `/fapi/v1/order` is refused; this step uses the algo endpoint.
  - `closePosition=true` cannot be combined with `quantity` or `reduceOnly`. We send `quantity` + `reduceOnly=true` (allowed in one-way mode; `reduceOnly` cannot be sent in hedge mode, which we block anyway).
  - Response carries `algoId`, `clientAlgoId`, `algoStatus`, `triggerPrice`, `createTime`...
  - Order weight 1 on the 10 s and 1 min order limits, 0 on the IP weight.
- **Query one algo order:** `GET /fapi/v1/algoOrder` with `algoId` or `clientAlgoId` (one required). Returns `algoStatus` and, once triggered, `actualOrderId`, `actualPrice`, `actualType`, `actualQty`. IP weight 1. Cancelled/expired orders with no fills are dropped after 3 days.
- **Cancel one:** `DELETE /fapi/v1/algoOrder`. **Cancel all:** `DELETE /fapi/v1/algoOpenOrders`. **Open algo orders:** "Current All Algo Open Orders" exists; its path was NOT visible in the page text (to verify in 8b; the page code guesses `GET /fapi/v1/openAlgoOrders` and falls back to nothing, see exec.js).
- **Client ids:** `newClientOrderId` and `clientAlgoId` both match `^[\.A-Z\:/a-z0-9_-]{1,36}$`; algo ids must be unique among open orders. Ours: `svx_<sys hash>_<time>_<role><n>` (under 36 characters).
- **Market order response:** `newOrderRespType` is `ACK` (default) or `RESULT`. With `RESULT` a MARKET order returns FILLED with `avgPrice` and `executedQty`. We send `RESULT`. A commission is not in that response; the page reads it from `userTrades` for the order.
- **Position mode:** `GET /fapi/v1/positionSide/dual` returns `dualSidePosition` (true = hedge), weight 30. The change endpoint's path was cut off (we never change it; we only block when hedge mode is on). Error -4059 / -4061 exist for position-side mismatch.
- **Error codes:** -2022 REDUCE_ONLY_REJECT (conflicts with open orders / nothing to reduce); -2021 ORDER_WOULD_IMMEDIATELY_TRIGGER; -2013 NO_SUCH_ORDER; -1021 INVALID_TIMESTAMP (outside recvWindow, or more than 1000 ms ahead of server time); **-1007 TIMEOUT: "execution status is unknown"** (the case for lookup by client id).
- **Limits:** weight is per IP, order counts per account; HTTP 429 means back off, 418 is an IP ban (2 minutes to 3 days). The per-minute caps are in `exchangeInfo.rateLimits` (not stated on the page). `recvWindow` default 5000 ms. Demo REST `https://demo-fapi.binance.com`.

## Differs from what the prompt assumed

1. The stop is not on `/fapi/v1/order`; it is on the algo endpoint, and its cancel and lookup are algo calls too (different id: `algoId` / `clientAlgoId`). The existing `BROKER.binance.place` is untouched; new functions are added.
2. Reduce-only stop uses `quantity` + `reduceOnly`, not `closePosition` (which forbids both).
3. The open-orders list is two lists (regular and algo); the page merges them.

## To verify on the demo host in 8b (not yet done)

- the open algo orders path and the shape of its answer;
- that a stop with a trigger on the wrong side of the price is rejected (-2021) and how the algo endpoint reports it;
- whether `userTrades` returns the commission for a market order immediately.

## Found on the demo host, 2026-11-12 (8b, before any order)

- **CORS preflight.** From a browser page, `demo-fapi.binance.com` (and the older `testnet.binancefuture.com`) answers the OPTIONS preflight for `/fapi/v1/openOrders` and `/fapi/v1/order` with **404**, and for `/fapi/v1/algoOrder` with **500**, with no `Access-Control-Allow-Headers`. `/fapi/v2/balance`, `/fapi/v1/userTrades`, `/fapi/v2/positionRisk`, `/fapi/v1/positionSide/dual` answer 204 with `Allow-Headers: *`. The live host answers 204 for all of them. So a page cannot log in to demo (the snapshot reads open orders) nor place any order with the `X-MBX-APIKEY` header. A search found no report of it.
- **Fix used:** `demo-proxy.mjs` (repo root), a local proxy on 127.0.0.1 that answers the preflight and forwards to the demo host only. The page verifies `GET /__proxy` says the target is the demo host before it logs in.
