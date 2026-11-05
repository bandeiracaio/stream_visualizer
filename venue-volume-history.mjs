#!/usr/bin/env node
// venue-volume-history.mjs  (repo root, offline-style tool, not part of the app, no release needed)
//
// Downloads FREE public historical BTC trade data (no accounts, no keys) and prints per-venue
// traded USD volume and market share per UTC day (and per hour with --out / --hourly).
//
//   node venue-volume-history.mjs [--days N] [--cache DIR] [--out FILE(.json|.csv)] [--hourly] [--selftest]
//
// Sources (all verified to work):
//   Binance perp / spot  data.binance.vision daily 1h klines (tiny; quote volume + taker buy quote volume)
//   Bybit   perp / spot  public.bybit.com daily trades csv.gz (50 MB / 8 MB a day; streamed, taker side known)
//   OKX     perp / spot  okx.com/cdn/okex/traderecords daily trades zip (streamed; files are UTC+8 days,
//                        so a UTC day needs two files; swap size = contracts * ctVal 0.01 BTC)
//   Coinbase spot        api.exchange.coinbase.com BTC-USD 1h candles (BTC volume * typical price; no taker split)
//   Hyperliquid perp     info API candleSnapshot 1h (BTC volume * typical price; no taker split;
//                        only the most recent ~5000 candles, about 208 days, are served)
// Downloaded files are untrusted: they are streamed through zlib and reduced to hourly sums; the raw
// bytes are never written to disk and nothing from them is executed. The cache holds only reduced JSON.
// Sequential downloads, retries with backoff, a 404 day is skipped.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Readable, Transform } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';

const HOUR = 3600e3, DAY = 86400e3;
const OKX_CT_VAL = 0.01; // BTC per BTC-USDT-SWAP contract (public/instruments ctVal)

// ---------- accumulators and parsers (pure) ----------
// acc: Map<hourStartMs, [usd, buyUsd, sellUsd]>; buy/sell are NaN-free numbers, or null totals when side is unknown.
function add(acc, tMs, usd, side) {
  const h = Math.floor(tMs / HOUR) * HOUR;
  let a = acc.get(h);
  if (!a) { a = [0, 0, 0, 0]; acc.set(h, a); } // usd, buy, sell, sideKnownUsd
  a[0] += usd;
  if (side === 'b') { a[1] += usd; a[3] += usd; } else if (side === 's') { a[2] += usd; a[3] += usd; }
}
function splitLines(text, onLine) { for (const l of text.split('\n')) if (l) onLine(l.replace(/\r$/, '')); }

const PARSERS = {
  // open_time,open,high,low,close,volume,close_time,quote_volume,count,taker_buy_volume,taker_buy_quote_volume,ignore
  binanceKline(line, acc) {
    const c = line.split(',');
    const t = +c[0]; if (!Number.isFinite(t) || !(t > 0)) return;
    const q = +c[7], tb = +c[10];
    const h = Math.floor(t / HOUR) * HOUR; // newer files use microseconds? guard below
    const hh = t > 1e14 ? Math.floor(t / 1000 / HOUR) * HOUR : h;
    acc.set(hh, [q, tb, q - tb, q]);
  },
  // timestamp(s),symbol,side,size,price,...   side = taker side
  bybitPerp(line, acc) {
    const c = line.split(',');
    const t = +c[0]; if (!(t > 0)) return;
    add(acc, t * 1000, +c[3] * +c[4], c[2] === 'Buy' ? 'b' : c[2] === 'Sell' ? 's' : '');
  },
  // id,timestamp(ms),price,volume,side,rpi
  bybitSpot(line, acc) {
    const c = line.split(',');
    const t = +c[1]; if (!(t > 0)) return;
    add(acc, t, +c[2] * +c[3], c[4] === 'buy' ? 'b' : c[4] === 'sell' ? 's' : '');
  },
  // instrument_name,trade_id,side,price,size,created_time,source   (size: contracts for SWAP, BTC for spot)
  okxPerp(line, acc) { okx(line, acc, OKX_CT_VAL); },
  okxSpot(line, acc) { okx(line, acc, 1); },
};
function okx(line, acc, ct) {
  const c = line.split(',');
  const t = +c[5]; if (!(t > 0)) return;
  add(acc, t, +c[3] * +c[4] * ct, c[2] === 'buy' ? 'b' : c[2] === 'sell' ? 's' : '');
}
// Coinbase candle [time(s), low, high, open, close, volume(BTC)]
function coinbaseCandles(arr, acc) {
  for (const k of arr) { const [t, lo, hi, , cl, v] = k; acc.set(t * 1000, [v * (lo + hi + cl) / 3, 0, 0, 0]); }
}
// Hyperliquid {t,o,h,l,c,v}
function hlCandles(arr, acc) {
  for (const k of arr) { const t = +k.t; acc.set(t, [+k.v * (+k.h + +k.l + +k.c) / 3, 0, 0, 0]); }
}

// ---------- streaming ----------
async function consume(readable, onLine) {
  const dec = new StringDecoder('utf8'); let rest = '';
  for await (const ch of readable) {
    const s = rest + dec.write(ch); const i = s.lastIndexOf('\n');
    if (i < 0) { rest = s; continue; }
    splitLines(s.slice(0, i), onLine); rest = s.slice(i + 1);
  }
  rest += dec.end(); if (rest) splitLines(rest, onLine);
}
// strips a ZIP local file header (single-file archive) so the rest is a raw deflate stream
function zipStrip() {
  let buf = Buffer.alloc(0), done = false;
  return new Transform({
    transform(chunk, _e, cb) {
      if (done) return cb(null, chunk);
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 30) return cb();
      if (buf.readUInt32LE(0) !== 0x04034b50) return cb(new Error('not a zip'));
      if (buf.readUInt16LE(8) !== 8) return cb(new Error('zip method not deflate'));
      const n = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
      if (buf.length < n) return cb();
      done = true; const out = buf.subarray(n); buf = null; cb(null, out);
    },
  });
}
function streamFor(res, kind) {
  const src = Readable.fromWeb(res.body);
  if (kind === 'zip') return src.pipe(zipStrip()).pipe(zlib.createInflateRaw());
  if (kind === 'gz') return src.pipe(zlib.createGunzip());
  return src;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withRetry(fn, label) {
  let err;
  for (let a = 0; a < 4; a++) {
    try { return await fn(); } catch (e) {
      if (e.notFound) return null;
      err = e; if (a < 3) { console.error(`  retry ${a + 1} ${label}: ${e.message}`); await sleep(1500 * 2 ** a); }
    }
  }
  throw err;
}
async function get(url, init) {
  const res = await fetch(url, { ...init, headers: { 'User-Agent': 'venue-volume-history/1', ...(init && init.headers) } });
  if (res.status === 404 || res.status === 403) { const e = new Error('HTTP ' + res.status); e.notFound = true; throw e; }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res;
}
async function fileSource(url, kind, parser) {
  return withRetry(async () => {
    const acc = new Map(); const res = await get(url);
    await consume(streamFor(res, kind), (l) => parser(l, acc));
    return acc;
  }, url);
}

// ---------- sources ----------
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const SOURCES = [
  { id: 'binance perp', venue: 'binance', kind: 'perp', fileDays: (d) => [d], fetch: (d) => fileSource(`https://data.binance.vision/data/futures/um/daily/klines/BTCUSDT/1h/BTCUSDT-1h-${d}.zip`, 'zip', PARSERS.binanceKline) },
  { id: 'binance spot', venue: 'binance', kind: 'spot', fileDays: (d) => [d], fetch: (d) => fileSource(`https://data.binance.vision/data/spot/daily/klines/BTCUSDT/1h/BTCUSDT-1h-${d}.zip`, 'zip', PARSERS.binanceKline) },
  { id: 'bybit perp', venue: 'bybit', kind: 'perp', fileDays: (d) => [d], fetch: (d) => fileSource(`https://public.bybit.com/trading/BTCUSDT/BTCUSDT${d}.csv.gz`, 'gz', PARSERS.bybitPerp) },
  { id: 'bybit spot', venue: 'bybit', kind: 'spot', fileDays: (d) => [d], fetch: (d) => fileSource(`https://public.bybit.com/spot/BTCUSDT/BTCUSDT_${d}.csv.gz`, 'gz', PARSERS.bybitSpot) },
  // OKX day files are UTC+8: file X = X-1 16:00Z .. X 16:00Z, so UTC day D needs files D and D+1.
  { id: 'okx perp', venue: 'okx', kind: 'perp', fileDays: (d) => [d, ymd(Date.parse(d) + DAY)], fetch: (d) => fileSource(`https://www.okx.com/cdn/okex/traderecords/trades/daily/${d.replace(/-/g, '')}/BTC-USDT-SWAP-trades-${d}.zip`, 'zip', PARSERS.okxPerp) },
  { id: 'okx spot', venue: 'okx', kind: 'spot', fileDays: (d) => [d, ymd(Date.parse(d) + DAY)], fetch: (d) => fileSource(`https://www.okx.com/cdn/okex/traderecords/trades/daily/${d.replace(/-/g, '')}/BTC-USDT-trades-${d}.zip`, 'zip', PARSERS.okxSpot) },
  { id: 'coinbase spot', venue: 'coinbase', kind: 'spot', fileDays: (d) => [d], fetch: (d) => withRetry(async () => {
    const t0 = Date.parse(d), acc = new Map();
    const r = await get(`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600&start=${new Date(t0).toISOString()}&end=${new Date(t0 + DAY - HOUR).toISOString()}`);
    const j = await r.json(); if (!Array.isArray(j)) throw new Error('coinbase: ' + JSON.stringify(j).slice(0, 80));
    coinbaseCandles(j, acc); return acc;
  }, 'coinbase ' + d) },
  { id: 'hyperliquid perp', venue: 'hyperliquid', kind: 'perp', fileDays: (d) => [d], fetch: (d) => withRetry(async () => {
    const t0 = Date.parse(d), acc = new Map();
    const r = await get('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'candleSnapshot', req: { coin: 'BTC', interval: '1h', startTime: t0, endTime: t0 + DAY - 1 } }) });
    const j = await r.json(); if (!Array.isArray(j)) throw new Error('hl: ' + JSON.stringify(j).slice(0, 80));
    hlCandles(j, acc); return acc;
  }, 'hl ' + d) },
];

// reduced cache: one JSON per (source, file day): { "<hourMs>": [usd,buy,sell,sideKnown] }
function cachePath(dir, src, d) { return path.join(dir, src.id.replace(' ', '_') + '_' + d + '.json'); }
async function loadFile(dir, src, d, todayMs) {
  const p = cachePath(dir, src, d);
  if (fs.existsSync(p)) return new Map(Object.entries(JSON.parse(fs.readFileSync(p, 'utf8'))).map(([k, v]) => [+k, v]));
  const acc = await src.fetch(d);
  if (!acc || !acc.size) return null;
  if (Date.parse(d) + DAY <= todayMs) fs.writeFileSync(p, JSON.stringify(Object.fromEntries(acc))); // only finished days
  return acc;
}

// ---------- aggregation (pure) ----------
// hours: Map<sourceId, Map<hourMs,[usd,buy,sell,known]>>, days: array of 'YYYY-MM-DD'
// returns per day: per-source {usd, hours, buyPct} and shares over the hours every source has ("common").
function aggregate(hours, srcIds, days) {
  const out = [];
  for (const d of days) {
    const t0 = Date.parse(d), hs = []; for (let i = 0; i < 24; i++) hs.push(t0 + i * HOUR);
    const have = (id, h) => hours.get(id) && hours.get(id).has(h);
    const common = hs.filter((h) => srcIds.every((id) => have(id, h)));
    const row = { day: d, commonHours: common.length, src: {} };
    let tot = 0;
    for (const id of srcIds) {
      let usd = 0, buy = 0, known = 0, n = 0;
      for (const h of hs) if (have(id, h)) n++;
      for (const h of common) { const a = hours.get(id).get(h); usd += a[0]; buy += a[1]; known += a[3] || 0; }
      row.src[id] = { usd, hours: n, buyPct: known > 0 ? 100 * buy / known : null };
      tot += usd;
    }
    row.total = tot;
    for (const id of srcIds) row.src[id].share = tot > 0 ? 100 * row.src[id].usd / tot : null;
    const kinds = { perp: 0, spot: 0 };
    for (const s of SOURCES) if (row.src[s.id]) kinds[s.kind] += row.src[s.id].usd;
    row.perpPct = tot > 0 ? 100 * kinds.perp / tot : null;
    out.push(row);
  }
  return out;
}

// ---------- output ----------
const f = (x, n = 1) => (x == null || !Number.isFinite(x) ? '-' : x.toFixed(n));
function table(head, rows) {
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => (i ? String(c).padStart(w[i]) : String(c).padEnd(w[i]))).join('  ');
  return [line(head), w.map((x) => '-'.repeat(x)).join('  '), ...rows.map(line)].join('\n');
}
function report(agg, srcIds) {
  const days = agg.map((a) => a.day);
  const lines = [];
  lines.push('USD volume per UTC day, billions (only hours every source has; hours shown in the last row)');
  lines.push(table(['source', ...days], [...srcIds.map((id) => [id, ...agg.map((a) => f(a.src[id].usd / 1e9, 2))]), ['TOTAL', ...agg.map((a) => f(a.total / 1e9, 2))], ['common hours', ...agg.map((a) => a.commonHours)]]));
  lines.push('', 'Market share %, of the sources above');
  lines.push(table(['source', ...days], srcIds.map((id) => [id, ...agg.map((a) => f(a.src[id].share))])));
  lines.push('', 'Perp vs spot (share of total %)');
  lines.push(table(['', ...days], [['perp', ...agg.map((a) => f(a.perpPct))], ['spot', ...agg.map((a) => f(a.perpPct == null ? null : 100 - a.perpPct))]]));
  lines.push('', 'Taker buy share of side-known volume % (- = venue gives no taker side for free)');
  lines.push(table(['source', ...days], srcIds.map((id) => [id, ...agg.map((a) => f(a.src[id].buyPct))])));
  lines.push('', 'Summary of share change over the period (percentage points)');
  const rows = srcIds.map((id) => {
    const v = agg.map((a) => a.src[id].share).filter((x) => x != null);
    if (!v.length) return [id, '-', '-', '-', '-', '-'];
    return [id, f(v[0]), f(v[v.length - 1]), f(v[v.length - 1] - v[0], 1), f(Math.min(...v)), f(Math.max(...v))];
  });
  lines.push(table(['source', 'first', 'last', 'change', 'min', 'max'], rows));
  return lines.join('\n');
}
function hourlyRows(hours, srcIds) {
  const all = new Set(); for (const id of srcIds) for (const h of hours.get(id).keys()) all.add(h);
  const rows = [];
  for (const h of [...all].sort((a, b) => a - b)) {
    let tot = 0; const present = srcIds.filter((id) => hours.get(id).has(h));
    for (const id of present) tot += hours.get(id).get(h)[0];
    for (const id of present) {
      const a = hours.get(id).get(h);
      rows.push({ hour: new Date(h).toISOString(), source: id, usd: Math.round(a[0]), buyUsd: a[3] ? Math.round(a[1]) : null, sellUsd: a[3] ? Math.round(a[2]) : null, sharePctOfPresent: tot ? +(100 * a[0] / tot).toFixed(3) : null, sourcesPresent: present.length });
    }
  }
  return rows;
}

// ---------- main ----------
function arg(name, dflt) { const i = process.argv.indexOf(name); return i < 0 ? dflt : process.argv[i + 1]; }
async function main() {
  if (process.argv.includes('--selftest')) return selftest();
  const nDays = +arg('--days', 7) || 7;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cache = path.resolve(arg('--cache', path.join(here, '.venue-volume-cache')));
  fs.mkdirSync(cache, { recursive: true });
  const todayMs = Math.floor(Date.now() / DAY) * DAY;
  const days = []; for (let i = nDays; i >= 1; i--) days.push(ymd(todayMs - i * DAY));
  const hours = new Map(SOURCES.map((s) => [s.id, new Map()]));
  const t00 = Date.now(), lo = Date.parse(days[0]), hi = Date.parse(days[days.length - 1]) + DAY;
  for (const s of SOURCES) {
    const fileDays = [...new Set(days.flatMap((d) => s.fileDays(d)))];
    let got = 0, missing = [];
    for (const d of fileDays) {
      const acc = await loadFile(cache, s, d, todayMs).catch((e) => { console.error(`  ${s.id} ${d}: ${e.message}`); return null; });
      if (!acc) { missing.push(d); continue; }
      got++;
      for (const [h, v] of acc) if (h >= lo && h < hi) {
        const cur = hours.get(s.id).get(h);
        if (!cur) hours.get(s.id).set(h, v.slice()); else for (let i = 0; i < 4; i++) cur[i] += v[i] || 0; // OKX: two files may share no hour; sum is safe
      }
    }
    console.error(`${s.id}: ${got}/${fileDays.length} files${missing.length ? ' (skipped ' + missing.join(', ') + ')' : ''}`);
  }
  const live = SOURCES.filter((s) => hours.get(s.id).size).map((s) => s.id);
  if (!live.length) { console.error('no data'); process.exit(1); }
  let agg = aggregate(hours, live, days);
  // venues publish with a lag (yesterday is often not up yet): drop days where no hour is common to all sources
  const empty = agg.filter((a) => a.commonHours === 0).map((a) => a.day);
  if (empty.length) { console.error(`dropped days with no hour covered by every source: ${empty.join(', ')} (use --days ${nDays + empty.length} for more)`); agg = agg.filter((a) => a.commonHours > 0); }
  console.log(report(agg, live));
  const out = arg('--out', null);
  const rows = hourlyRows(hours, live);
  if (process.argv.includes('--hourly') && !out) console.log('\n' + rows.map((r) => `${r.hour} ${r.source.padEnd(17)} ${String(r.usd).padStart(14)} ${r.sharePctOfPresent}%`).join('\n'));
  if (out) {
    if (out.endsWith('.json')) fs.writeFileSync(out, JSON.stringify(rows));
    else fs.writeFileSync(out, 'hour,source,usd,buyUsd,sellUsd,sharePctOfPresent,sourcesPresent\n' + rows.map((r) => [r.hour, r.source, r.usd, r.buyUsd ?? '', r.sellUsd ?? '', r.sharePctOfPresent ?? '', r.sourcesPresent].join(',')).join('\n') + '\n');
    console.error(`hourly rows (${rows.length}) written to ${out}`);
  }
  console.error(`runtime ${((Date.now() - t00) / 1000).toFixed(1)} s`);
}

// ---------- self-test (no network) ----------
async function selftest() {
  let bad = 0; const ok = (c, m) => { if (!c) { bad++; console.log('FAIL', m); } };
  const near = (a, b) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));
  const H0 = Date.parse('2026-11-03T00:00:00Z');
  let acc = new Map(); splitLines('open_time,open\n' + `${H0},1,1,1,1,1,${H0 + 3599999},1000,5,300,400,0\n`, (l) => PARSERS.binanceKline(l, acc));
  ok(acc.size === 1 && acc.get(H0)[0] === 1000 && acc.get(H0)[1] === 400 && acc.get(H0)[2] === 600, 'binance kline');
  acc = new Map(); splitLines(`timestamp,symbol\n${H0 / 1000 + 5.5},BTCUSDT,Buy,2,100,Z,id\n${H0 / 1000 + 3600},BTCUSDT,Sell,1,100,Z,id\n`, (l) => PARSERS.bybitPerp(l, acc));
  ok(near(acc.get(H0)[0], 200) && near(acc.get(H0)[1], 200) && near(acc.get(H0 + HOUR)[2], 100), 'bybit perp');
  acc = new Map(); splitLines(`id,timestamp\n1,${H0 + 10},50,2,sell,0\n2,${H0 + 20},50,1,buy,0\n`, (l) => PARSERS.bybitSpot(l, acc));
  ok(near(acc.get(H0)[0], 150) && near(acc.get(H0)[1], 50) && near(acc.get(H0)[2], 100), 'bybit spot');
  acc = new Map(); splitLines(`instrument_name,trade_id\nBTC-USDT-SWAP,1,sell,100,10,${H0 + 5},0\n`, (l) => PARSERS.okxPerp(l, acc));
  ok(near(acc.get(H0)[0], 100 * 10 * 0.01) && near(acc.get(H0)[2], 10), 'okx perp ctVal');
  acc = new Map(); splitLines(`BTC-USDT,1,buy,100,0.5,${H0 + 5},0\n`, (l) => PARSERS.okxSpot(l, acc));
  ok(near(acc.get(H0)[0], 50), 'okx spot');
  acc = new Map(); coinbaseCandles([[H0 / 1000, 90, 120, 100, 105, 2]], acc); ok(near(acc.get(H0)[0], 2 * 105), 'coinbase');
  acc = new Map(); hlCandles([{ t: H0, h: '120', l: '90', c: '105', v: '3' }], acc); ok(near(acc.get(H0)[0], 315), 'hl');
  // streaming: gzip + chunked lines + zip header
  const text = 'a,b\n1,2\n3,4\n'; const got = [];
  await consume(Readable.from([zlib.gzipSync(text).subarray(0, 10), zlib.gzipSync(text).subarray(10)]).pipe(zlib.createGunzip()), (l) => got.push(l));
  ok(got.join('|') === 'a,b|1,2|3,4', 'gz stream ' + got);
  const raw = zlib.deflateRawSync(Buffer.from(text)); const name = Buffer.from('x.csv');
  const hdr = Buffer.alloc(30); hdr.writeUInt32LE(0x04034b50, 0); hdr.writeUInt16LE(8, 8); hdr.writeUInt16LE(name.length, 26);
  const zip = Buffer.concat([hdr, name, raw, Buffer.from('PK-trailing-junk')]); const g2 = [];
  await consume(Readable.from([zip.subarray(0, 7), zip.subarray(7, 40), zip.subarray(40)]).pipe(zipStrip()).pipe(zlib.createInflateRaw()), (l) => g2.push(l));
  ok(g2.join('|') === 'a,b|1,2|3,4', 'zip stream ' + g2);
  // aggregation: venue B misses hour 1, so common hours = 23 for that day
  const mk = (v) => new Map(Array.from({ length: 24 }, (_, i) => [H0 + i * HOUR, [v, v / 2, v / 2, v]]));
  const A = mk(100), B = mk(300); B.delete(H0 + HOUR);
  const ag = aggregate(new Map([['binance perp', A], ['okx spot', B]]), ['binance perp', 'okx spot'], ['2026-11-03']);
  ok(ag[0].commonHours === 23 && near(ag[0].src['binance perp'].share, 25) && near(ag[0].src['okx spot'].share, 75), 'aggregate shares');
  ok(near(ag[0].perpPct, 25) && near(ag[0].src['okx spot'].buyPct, 50) && ag[0].src['okx spot'].hours === 23, 'aggregate perp/buy');
  ok(ymd(H0) === '2026-11-03' && SOURCES[4].fileDays('2026-11-03')[1] === '2026-11-04', 'okx file days');
  console.log(bad ? bad + ' selftest failures' : 'selftest ok'); process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
