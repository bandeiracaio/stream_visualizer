// Label queue (pure, self-tested): which episode group to show next when you are going through them to agree / disagree.
// Groups are taken oldest first (by detection time), skipping forming ones (a forming card cannot be labelled) and the ones already labelled, optionally only the families in `fams` (a Set; empty or null = all).
// `pick` walks from the current group in a direction and wraps around, so after a label the next open group follows it; with no current group it starts at the first (or last) one.
const LABELQ = (() => {
  const isForming = g => String(g.id).startsWith("f|");
  const when = g => g.tDetected || g.tStart || 0;
  function sorted(groups, fams) {
    return groups.filter(g => !isForming(g) && (!fams || !fams.size || fams.has(g.family))).sort((a, b) => when(a) - when(b) || String(a.id).localeCompare(String(b.id)));
  }
  function progress(groups, labelOf, fams) {
    const s = sorted(groups, fams); let done = 0; for (const g of s) if (labelOf(g)) done++;
    return { total:s.length, labelled:done, open:s.length - done };
  }
  function pick(groups, labelOf, currentId, dir, fams) {
    const s = sorted(groups, fams), n = s.length; if (!n) return null;
    const cur = currentId == null ? -1 : s.findIndex(g => String(g.id) === String(currentId)), step = dir < 0 ? -1 : 1, start = cur >= 0 ? cur : (step > 0 ? -1 : n);
    for (let k = 1; k <= n; k++) { const j = (((start + step*k) % n) + n) % n; if (!labelOf(s[j])) return s[j].id; }
    return null;
  }
  return { sorted, progress, pick };
})();
