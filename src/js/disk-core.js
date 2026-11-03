// Disk space warning (pure, self-tested): how worried to be about the room left for recordings.
// A web page cannot read the drive's free space. What it can read is the browser's storage estimate (quota minus usage); Chrome caps that quota by what the drive has free,
// so it follows the drive down but reads lower than the real figure (about three quarters of it on the first machine it was checked on, 10.7 GB against 14.4 GB). That makes it a
// cautious number, which is the right side to err on: the text says "about" and the thresholds below are meant for it.
// `rate` is how many bytes a day of collecting adds, taken from the recordings saved lately; `assess` turns room and rate into a tone (ok / warn / bad / off) and a line of text.
const DISK = (() => {
  const GB = 1e9, T = {warnGB:5, badGB:2, warnH:12, badH:4};      // less than 5 GB, or less than 12 hours at the current rate, is a warning; 2 GB or 4 hours is red
  const size = b => b >= GB ? (b / GB).toFixed(1) + " GB" : Math.max(0, Math.round(b / 1e6)) + " MB";
  const span = h => h >= 48 ? Math.round(h / 24) + " days" : h >= 1 ? Math.round(h) + " h" : "under 1 h";
  // rows: [{at, size}] of saved recordings; looks at the last `windowH` hours and needs at least `minH` hours of them to call it a rate (otherwise null)
  function rate(rows, now, windowH = 6, minH = 1) {
    const from = now - windowH * 3600000, rs = (rows || []).filter(r => r && r.at >= from && r.size > 0);
    if (!rs.length) return null;
    const oldest = Math.min(...rs.map(r => r.at)), hours = Math.max(minH, (now - oldest) / 3600000);
    return rs.reduce((a, r) => a + r.size, 0) / hours;      // bytes per hour
  }
  function assess(freeBytes, bytesPerHour) {
    if (!(freeBytes >= 0)) return {tone:"off", text:"not known (this browser does not say)", hours:null};
    const hours = bytesPerHour > 0 ? freeBytes / bytesPerHour : null;
    const tone = freeBytes < T.badGB * GB || (hours != null && hours < T.badH) ? "bad" : freeBytes < T.warnGB * GB || (hours != null && hours < T.warnH) ? "warn" : "ok";
    return {tone, hours, text: "about " + size(freeBytes) + " left" + (hours != null ? ` · ${span(hours)} at ${size(bytesPerHour)}/h` : "")};
  }
  return {T, size, span, rate, assess};
})();
