// Analysis lab (pure, self-tested): the format of a lab entry and the small helpers the viewer and the build share.
// An entry is one experiment kept as a file in docs/lab/ (kind "sv-lab-entry"): the question, the data used, the method (enough to re-run), compact results and our verdict.
// Results are reduced on the PC by the offline scripts and never hold raw data, so the app can carry them offline. The build checks every entry with `validate` and refuses a bad one.
const LAB = (() => {
  const VERDICTS = ["confirmed", "rejected", "inconclusive", "idea", "sample"];      // sample = an example of the format, not a finding
  const BLOCKS = ["text", "table", "bars", "series"];
  const MAX_BYTES = 200 * 1024;
  const isStr = x => typeof x === "string", isNum = x => typeof x === "number" && isFinite(x), isArr = Array.isArray;

  function validateBlock(b, where, out) {
    if (!b || typeof b !== "object") { out.push(where + ": not an object"); return; }
    if (BLOCKS.indexOf(b.type) < 0) { out.push(where + ": unknown block type " + JSON.stringify(b.type)); return; }
    if (b.type === "text") { if (!isStr(b.text)) out.push(where + ": text needs a string"); return; }
    if (b.type === "table") {
      if (!isArr(b.columns) || !b.columns.length || !b.columns.every(isStr)) { out.push(where + ": table needs columns (strings)"); return; }
      if (!isArr(b.rows) || !b.rows.every(r => isArr(r) && r.length === b.columns.length)) out.push(where + ": every table row needs one cell per column");
      return;
    }
    if (b.type === "bars") {
      if (!isArr(b.items) || !b.items.length || !b.items.every(i => i && isStr(i.label) && isNum(i.value))) out.push(where + ": bars need items {label, value}");
      return;
    }
    if (!isArr(b.x) || !isArr(b.y) || b.x.length !== b.y.length || b.x.length < 2 || !b.y.every(isNum) || !b.x.every(isNum)) out.push(where + ": series needs numeric x and y of the same length (at least 2)");
  }

  // the list of problems with an entry; empty = fine
  function validate(e) {
    const out = [];
    if (!e || typeof e !== "object") return ["not an object"];
    if (e.kind !== "sv-lab-entry") out.push("kind must be \"sv-lab-entry\"");
    if (e.version !== 1) out.push("version must be 1");
    if (!isStr(e.id) || !/^[a-z0-9][a-z0-9-]*$/.test(e.id)) out.push("id must be lowercase letters, digits and dashes");
    if (!isStr(e.title) || !e.title.trim()) out.push("title is missing");
    if (!isStr(e.date) || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) out.push("date must be YYYY-MM-DD");
    if (VERDICTS.indexOf(e.verdict) < 0) out.push("verdict must be one of " + VERDICTS.join(", "));
    if (!isStr(e.question) || !e.question.trim()) out.push("question is missing");
    if (!e.method || !isStr(e.method.summary)) out.push("method.summary is missing");
    else if (e.method.plan !== undefined && !(isArr(e.method.plan) && e.method.plan.every(isStr))) out.push("method.plan must be a list of strings");
    if (e.data !== undefined && (typeof e.data !== "object" || e.data === null || (e.data.files !== undefined && !(isArr(e.data.files) && e.data.files.every(isStr))))) out.push("data.files must be a list of strings");
    if (e.tags !== undefined && !(isArr(e.tags) && e.tags.every(isStr))) out.push("tags must be a list of strings");
    if (!isArr(e.results)) out.push("results must be a list of blocks");
    else e.results.forEach((b, i) => validateBlock(b, "results[" + i + "]", out));
    return out;
  }

  // newest first; same day by id so the order never depends on file order
  const sorted = list => list.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // verdict "" or "all" = every verdict; q matches title, question, tags and id (case-insensitive)
  function filter(list, verdict, q) {
    const s = String(q || "").trim().toLowerCase();
    return list.filter(e => (!verdict || verdict === "all" || e.verdict === verdict) && (!s || [e.title, e.question, e.id].concat(e.tags || []).some(x => String(x).toLowerCase().indexOf(s) >= 0)));
  }
  const counts = list => { const c = {}; for (const v of VERDICTS) c[v] = 0; for (const e of list) if (c[e.verdict] !== undefined) c[e.verdict]++; return c; };
  // a short number for a table cell or a bar: no long float tails
  function fmt(v) {
    if (v === null || v === undefined) return "–";
    if (typeof v !== "number") return String(v);
    if (!isFinite(v)) return String(v);
    const a = Math.abs(v); if (a === 0) return "0";
    if (a >= 1e6) return (v / 1e6).toPrecision(3) + "M";
    if (a >= 1000) return String(Math.round(v));
    if (a >= 100) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    return v.toPrecision(2);
  }
  return { VERDICTS, BLOCKS, MAX_BYTES, validate, sorted, filter, counts, fmt };
})();
