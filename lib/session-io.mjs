// Reads a saved session (session_*.json.gz / .json) or a tape into {kind, records, inputs, ...}. Moved out of analyze-collectors.mjs (now in archive/) unchanged.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const COLLECT = vm.runInNewContext(fs.readFileSync(path.join(root, "src/js/collectors-core.js"), "utf8") + "\n;COLLECT", {});

export function readInput(file, light = false) {      // light: a session's `inputs` (the bulk of the file) is not kept or scanned; --merge does not use it
  let buf = fs.readFileSync(file);
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  const j = JSON.parse(buf.toString("utf8"));
  buf = null;
  if (j.kind === "sv-tape") return { file, kind:"tape", version:j.version, records:(j.records || []).filter(COLLECT.isRec), t0:null, t1:null };
  if (j.kind === "sv-session" && light) return { file, kind:"session", sym:j.sym, auto:!!j.pre, records:(j.ext || []).filter(COLLECT.isRec), t0:j.startedAt, t1:null, quality:j.quality || null, inputs:[] };
  if (j.kind === "sv-session") {
    const recs = (j.ext || []).filter(COLLECT.isRec), times = (j.inputs || []).map(r => r[0] === "t" ? r[1] && r[1].t : r[2]).filter(Number.isFinite);
    let end = recs.length ? recs[recs.length - 1][2] : j.startedAt; if (times.length) { end = -Infinity; for (const t of times) if (t > end) end = t; }      // a loop: a long recording has more inputs than Math.max can take as arguments
    return { file, kind:"session", sym:j.sym, auto:!!j.pre, records:recs, t0:j.startedAt, t1:end, quality:j.quality || null, inputs:j.inputs || [] };
  }
  throw new Error(file + ": not a tape or a session (kind " + j.kind + ")");
}

