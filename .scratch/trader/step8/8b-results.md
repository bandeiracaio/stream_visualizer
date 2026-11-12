# Step 8b: first hour on the Binance demo account (2026-11-12, 03:26 to 04:08 UTC, releases v146 to v149)

Done on a real demo key through `demo-proxy.mjs` (the demo host refuses the browser CORS preflight of /order, /openOrders, /algoOrder). Five systems (Book depth, Premium fade, Episode fade, Range break, Level rejection) were moved to demo by a console call to `trAppendStage` ("TEST INJECTION step 8b"); the five entries were removed afterwards (the stage log is empty again, all seven systems read paper).

## Connection check (v146, 00:23 local)
All 7 lines passed: balance / position / one-way mode; minimum market buy (0.0011 BTC, real commission returned at once); reduce-only stop placed and seen as an algo order (path `/fapi/v1/openAlgoOrders` is right); stop cancelled; a stop with a price that must be rejected was refused (`-2021`); position closed reduce-only; flat at the end.

## Mirror, measured (91 mirror rows, 20 real demo fills)
- Mean slip against the paper fill (positive = worse): entry +0.5 bps (median -0.07), exit +2.7 bps (median +2.87).
- Delay from paper fill to real fill: entry median 1,463 ms (max 2,591); exit median 2,461 ms (max 25,575, a retried exit).
- Real net per trade mean -10.2 bps against paper -9.0 bps on the same trades; fees mean 8.0 bps (taker 4 bps a side).
- Entries not mirrored (paper only): account busy 19, fault not cleared 39, kill switch 8, foreign position 3.
- Every trade was `capped` (the formula's notional is above 5,000).
- Only 40 minutes of mirroring (03:28 to 04:08), not 60: three reloads were needed to ship fixes. 20 demo trades (over 10).

## Tests
1. Reload while a position was open (v147): found the leftover own position and its stop at start, cancelled the stop, closed at market (73,724), row `interrupted`, fault raised, flat.
2. Network drop of 20 s (v146, the order path cut by stopping the proxy): the exit that fell inside the drop was retried and filled; row `exit retried`.
3. Network drop of 45 s while holding (v148): the exchange stop FIRED during the drop (bounded the loss, filled 73,763.1 against a short at 73,734.4), the page then recorded the trade `failed` with a fault. Fixed in v149; repeated on v149: the exit was cut off, the poll resent it when the network was back, closed flat, row `filled / demo`, `exit retried`, faults raised.
4. Kill switch while holding (v148): flat, orders cancelled, switch stored on, row exit reason `kill switch`, state `killed`.
5. Position opened by hand (0.002 BTC): `foreign position found` fault, position untouched, new entries refused ("blocked: a position on this asset that is not the page's own"), block lifted by itself when it was closed by hand.

## Faults in the log at the end (13)
Caused by the tests: leftover own position (reload), the 03:54 group of four (45 s drop, v148), foreign position found (hand), the 04:07 group of three (45 s drop, v149).
NOT caused by the tests: `stop rejected` x2 (03:36:14 and 04:01:32: `-2021 Order would immediately trigger`; the stop is only about 6 bps from entry (median 6.0) and the real fill had moved past it) and `unknown order state` x2 (03:40:45/48: the demo host stopped answering for about two minutes; the page stayed stuck exiting until v147 / v148 fixed it).
So the log does not hold "exactly the faults you caused" (prompt check 3), and step 9's "a week without a fault" will be hard at this stop distance.

## Found and fixed during 8b
- v147: an exit that needed a second attempt was not a fault when the first got no answer; an exit left unknown was never sent again.
- v148: a stalled exit is taken up again by the poll; a lookup with no answer keeps its own 5 s clock.
- v149: a flat exchange with no exit order of ours means the resting stop fired: its fill is the real exit; follow-up lookups that expire are asked again.

## Replay
`node design-harness.mjs --replay-run sessions/session_BTC_202611120404_run20261112040445-c000.json.gz`: 1 run, 21 rows, equal. Only this chunk exists: a reload cuts the open chunk before its 30 minutes, so the runs before it were not saved (the page cannot close a chunk on a reload).

## Secret search
Journal, mirror rows, fault log, localStorage, Health log, the stored database, the stored chunk (decompressed), the chunk file on disk, the proxy logs (no query strings), tracked files and git history: no key, secret or `signature=`; the page's own source mentions the header name and `signature=` in code. The page console was not tracked before the last check (it showed no messages).
