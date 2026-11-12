#!/usr/bin/env node
// Local CORS proxy for the Binance DEMO futures host (Trader step 8b). Why: demo-fapi.binance.com answers the browser's CORS preflight for /fapi/v1/order, /openOrders and /algoOrder with 404/500 and no
// Access-Control-Allow-Headers, so a page cannot call them with the X-MBX-APIKEY header (the live host and the balance / userTrades / positionRisk routes are fine). This script answers the preflight itself and
// forwards the real request, unchanged, to the demo host. The page signs requests exactly as before; the keys are typed into the page, never given to this script (it only passes the header and the query on).
// Run:  node demo-proxy.mjs            (port 8787; PORT=9000 node demo-proxy.mjs to change it). Then in the page's Binance demo card put  http://127.0.0.1:8787  in "Proxy address".
// Safety: listens on 127.0.0.1 only; forwards ONLY to demo-fapi.binance.com and only paths under /fapi/; serves only the pages' origins below (the GitHub Pages site, localhost, a local file); logs method, path,
// status and time, never a query string (that is where the signature is) or a header. `GET /__proxy` says which host it forwards to, so the page can refuse a proxy that points anywhere else.
import http from "node:http";
import https from "node:https";

const TARGET = "demo-fapi.binance.com", HOST = "127.0.0.1", PORT = +(process.env.PORT || 8787);
const ORIGINS = [/^https:\/\/bandeiracaio\.github\.io$/, /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/, /^null$/];
const PASS = ["x-mbx-apikey", "content-type", "accept"];      // request headers handed on
const log = (m, p, s, ms) => console.log(new Date().toISOString().slice(11, 23), m, p, s, ms + "ms");

function cors(req, res) {
  const o = req.headers.origin;
  if (o && !ORIGINS.some(r => r.test(o))) return false;
  res.setHeader("Access-Control-Allow-Origin", o || "*");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*, x-mbx-apikey, content-type");
  res.setHeader("Access-Control-Allow-Private-Network", "true");      // Chrome asks this when a public https page calls a local address
  res.setHeader("Access-Control-Max-Age", "600");
  return true;
}

http.createServer((req, res) => {
  const t0 = Date.now(), path = (req.url || "/").split("?")[0];
  const done = s => log(req.method, path, s, Date.now() - t0);
  if (!cors(req, res)) { res.statusCode = 403; res.end("origin not allowed"); return done(403); }
  if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return done(204); }
  if (path === "/__proxy") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ proxy: "sv-demo-proxy", target: "https://" + TARGET })); return done(200); }
  if (!path.startsWith("/fapi/")) { res.statusCode = 404; res.end("only /fapi/ is forwarded"); return done(404); }
  const headers = { host: TARGET }; for (const h of PASS) if (req.headers[h]) headers[h] = req.headers[h];
  const up = https.request({ host: TARGET, port: 443, method: req.method, path: req.url, headers, timeout: 15000 }, r => {
    for (const [k, v] of Object.entries(r.headers)) if (!k.toLowerCase().startsWith("access-control-") && k.toLowerCase() !== "transfer-encoding" && k.toLowerCase() !== "connection") res.setHeader(k, v);
    res.statusCode = r.statusCode; r.pipe(res); r.on("end", () => done(r.statusCode));
  });
  up.on("timeout", () => up.destroy(new Error("timeout")));
  up.on("error", e => { if (!res.headersSent) { res.statusCode = 502; res.end(JSON.stringify({ code: -1001, msg: "proxy: " + e.message })); } else res.destroy(); done(502); });
  req.pipe(up);
}).listen(PORT, HOST, () => console.log(`demo proxy: http://${HOST}:${PORT} -> https://${TARGET}  (Ctrl+C to stop)`));
