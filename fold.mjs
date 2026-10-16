// Folds approved threshold revisions into the built-in defaults.
//   node fold.mjs             apply every revision file in docs/revisions/ that says "Folded: no"
//   node fold.mjs --check     show what would change, write nothing
//   node fold.mjs --root DIR  work on another checkout (used for testing)
// A revision file (written by the app when you approve or reset a threshold) holds a ```json block with kind "approval" or
// "revert". Files are applied in time order. Each default is only changed if it still holds the value the file expects
// (`from`), so a file can never be applied twice or on top of a different default. Nothing is written unless every file fits.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2), check = args.includes("--check");
const root = args.includes("--root") ? path.resolve(args[args.indexOf("--root") + 1]) : path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const dir = path.join(root, "docs", "revisions");
const SRC = { cfg: path.join(root, "src", "js", "reader-engine.js"), ep: path.join(root, "src", "js", "reader-episodes.js") };
const fail = msg => { console.error("fold: " + msg + "\nNothing was changed."); process.exit(1); };

if (!fs.existsSync(dir)) { console.log("fold: no docs/revisions/ folder, nothing to do."); process.exit(0); }
const files = fs.readdirSync(dir).filter(f => f.endsWith(".md")).sort();
const todo = [];
for (const f of files) {
  const text = fs.readFileSync(path.join(dir, f), "utf8");
  if (!/^Folded: no\s*$/m.test(text)) continue;
  const m = text.match(/```json\s*([\s\S]*?)```/);
  if (!m) fail(`${f}: no json block found`);
  let j; try { j = JSON.parse(m[1]); } catch (e) { fail(`${f}: the json block does not parse (${e.message})`); }
  if (!["approval", "revert"].includes(j.kind) || j.v !== 1) fail(`${f}: unknown kind or version`);
  if (!SRC[j.where] || typeof j.key !== "string" || !Number.isFinite(j.from) || !Number.isFinite(j.to)) fail(`${f}: missing key, location or values`);
  todo.push({ f, text, j, at: j.approvedAt || j.time || 0 });
}
if (!todo.length) { console.log("fold: nothing to fold."); process.exit(0); }
todo.sort((a, b) => a.at - b.at || a.f.localeCompare(b.f));

// the object literal assigned to `const DEFAULTS = {...}` in a source file
function region(src, file) {
  const start = src.indexOf("const DEFAULTS = {"); if (start < 0) fail(`${file}: no DEFAULTS object`);
  let depth = 0, i = src.indexOf("{", start);
  for (let k = i; k < src.length; k++) { if (src[k] === "{") depth++; else if (src[k] === "}" && --depth === 0) return [i, k + 1]; }
  fail(`${file}: DEFAULTS object is not closed`);
}
const style = x => String(x).replace(/^(-?)0\./, "$1.");       // the source writes .65, not 0.65
const text = {}; for (const w of Object.keys(SRC)) text[w] = fs.readFileSync(SRC[w], "utf8");
const plan = [];
for (const t of todo) {
  const [a, b] = region(text[t.j.where], SRC[t.j.where]), body = text[t.j.where].slice(a, b);
  const re = new RegExp(`(\\b${t.j.key}:)(-?(?:\\d+\\.?\\d*|\\.\\d+))(?![\\w.])`, "g"), hits = [...body.matchAll(re)];
  if (hits.length !== 1) fail(`${t.f}: ${hits.length} places define "${t.j.key}" in ${path.basename(SRC[t.j.where])}, expected exactly 1`);
  const now = Number(hits[0][2]);
  if (Math.abs(now - t.j.from) > 1e-9) fail(`${t.f}: the default for ${t.j.key} is ${now}, but this file expects ${t.j.from}. It was already folded, or the default changed since. Fix the file's "Folded:" line or the source by hand.`);
  text[t.j.where] = text[t.j.where].slice(0, a) + body.replace(re, `$1${style(t.j.to)}`) + text[t.j.where].slice(b);
  plan.push(`${t.j.kind} ${t.j.key}: ${now} -> ${t.j.to}   (${t.f})`);
}
console.log((check ? "fold (check only), would change:\n  " : "fold, changing:\n  ") + plan.join("\n  "));
if (check) process.exit(0);
const day = new Date().toISOString().slice(0, 10);
for (const w of Object.keys(SRC)) fs.writeFileSync(SRC[w], text[w]);
for (const t of todo) fs.writeFileSync(path.join(dir, t.f), t.text.replace(/^Folded: no\s*$/m, `Folded: yes (${day})`));
console.log(`fold: ${todo.length} file${todo.length === 1 ? "" : "s"} folded. Review the diff, run the build, then release.`);
