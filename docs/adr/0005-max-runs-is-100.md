# 5. An arming keeps at most 100 runs (`maxRuns`)

Status: superseded by step 6b (v142): auto-record and arming were removed, so there is no `maxRuns`. The page records continuously while connected, in 30-minute chunks; the storage guards are the 24-hour browser copies and the "left running" list (disk room). Kept for the reasoning below.

`maxRuns` is the number of auto-recordings (runs) one arming may make before it disarms. It was 8 (v042). It is 100 since v097.

Why it exists: a storage bound. With rearm on, a volatile stretch could otherwise fill the browser's storage unattended. The cooldown (3 min) and the 60 minute limit per run only limit how fast it fills, not how much.

Why 8 was wrong: the purpose of arming is unattended overnight collection. One night produced more than 8 volatile stretches (a stop at the time limit has no cooldown, and a flickering market starts new runs after 3 minutes), so the arming disarmed itself in the night and the rest of the data was never collected. The cap stopped the mission it was meant to protect.

Why 100: high enough that a night or a weekend of normal use does not reach it, low enough that a run-away arming still ends. It is not derived from a measured size; it is a backstop. The real storage guard is the low-disk warning in Arm mode (v098: browser storage estimate and hours left at the current recording rate), which watches the actual resource. A recording of BTC is about 1.3 MB gzipped per 30 minutes.

Consequences: if 100 is reached the arming ends with the message "That was recording N of at most 100 per arming". If storage, not count, becomes the limit, change the guard in the disk warning, not this number.
