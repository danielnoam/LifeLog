// LifeLog — dates: the one place that knows which day a week starts on and
// how a date is written (0.301.0, Settings → Appearance → Dates).
//
// Both choices live in data.settings (weekStart, dateFormat) so every device,
// the widgets and the bridge agree. The defaults are what the app did before
// the settings existed: weeks start on Sunday, dates read "3 Nov 2026".
//
// Data never changes shape: a stored date is still "2026-11-03" and a weekday
// is still 0 = Sunday. Only what's drawn and where a week begins move.
(function () {
  const WEEK_STARTS = [0, 1, 6];
  const FORMATS = ["dmy", "mdy", "dmy-num", "mdy-num", "iso"];
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  let source = () => null;
  // The app hands over a getter rather than a copy, so a setting changed on
  // another device and merged in is read on the next draw with nothing to
  // re-sync here.
  function bind(getSettings) { source = typeof getSettings === "function" ? getSettings : () => getSettings; }
  const settings = () => { try { return source() || {}; } catch { return {}; } };

  const cleanWeekStart = (v) => (WEEK_STARTS.includes(+v) ? +v : 0);
  const cleanFormat = (v) => (FORMATS.includes(v) ? v : "dmy");
  const weekStart = () => cleanWeekStart(settings().weekStart);
  const dateFormat = () => cleanFormat(settings().dateFormat);

  const pad = (n) => String(n).padStart(2, "0");
  const isDay = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function addDays(day, n) {
    const d = new Date(day + "T00:00:00");
    if (isNaN(d.getTime())) return day;
    d.setDate(d.getDate() + n);
    return localDay(d);
  }
  function dow(day) {
    const d = new Date(day + "T00:00:00");
    return isNaN(d.getTime()) ? -1 : d.getDay();
  }

  // The weekdays in the order a week runs, e.g. [6, 0, 1, 2, 3, 4, 5].
  const weekOrder = (ws = weekStart()) => [0, 1, 2, 3, 4, 5, 6].map((i) => (ws + i) % 7);
  // How far into its week a weekday is: 0 for the first day.
  const weekPos = (weekday, ws = weekStart()) => (weekday - ws + 7) % 7;
  function startOfWeek(day, ws = weekStart()) {
    const w = dow(day);
    return w < 0 ? day : addDays(day, -weekPos(w, ws));
  }
  // A week that starts on Saturday is an Israeli week: the weekend is Friday
  // and Saturday and the working days run Sunday to Thursday.
  const workDays = (ws = weekStart()) => (ws === 6 ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 5]);
  const weekendDays = (ws = weekStart()) => (ws === 6 ? [5, 6] : [0, 6]);

  // A "YYYY-MM-DD" string, a Date, or a timestamp, as { y, m, d, wd }.
  function parts(x) {
    if (isDay(x)) {
      const y = +x.slice(0, 4), m = +x.slice(5, 7), d = +x.slice(8, 10);
      return { y, m, d, wd: new Date(y, m - 1, d).getDay() };
    }
    const t = x instanceof Date ? x : new Date(x);
    if (x === null || x === undefined || x === "" || isNaN(t.getTime())) return null;
    return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate(), wd: t.getDay() };
  }

  // One date. opts.year: true (the default), false, or "auto" (only when it
  // isn't this year). opts.weekday puts "Tue" in front.
  function day(x, opts = {}) {
    const p = parts(x);
    if (!p) return "";
    const f = opts.format ? cleanFormat(opts.format) : dateFormat();
    const yr = opts.year === undefined ? true : opts.year === "auto" ? p.y !== new Date().getFullYear() : !!opts.year;
    const wd = opts.weekday ? WEEKDAYS[p.wd] : "";
    let s;
    if (f === "iso") s = `${p.y}-${pad(p.m)}-${pad(p.d)}`;
    else if (f === "dmy-num") s = `${pad(p.d)}/${pad(p.m)}` + (yr ? "/" + p.y : "");
    else if (f === "mdy-num") s = `${pad(p.m)}/${pad(p.d)}` + (yr ? "/" + p.y : "");
    else if (f === "mdy") s = `${MONTHS[p.m - 1]} ${p.d}` + (yr ? ", " + p.y : "");
    else s = `${p.d} ${MONTHS[p.m - 1]}` + (yr ? " " + p.y : "");
    if (!wd) return s;
    return f === "mdy" ? wd + ", " + s : wd + " " + s;
  }

  // A day and a month with no year, for "every year on…": "3 March",
  // "March 3", "03/03", "03-03".
  function dayMonth(d, m, format) {
    const f = format ? cleanFormat(format) : dateFormat();
    if (f === "iso") return `${pad(m)}-${pad(d)}`;
    if (f === "dmy") return `${d} ${MONTH_NAMES[m - 1]}`;
    if (f === "mdy") return `${MONTH_NAMES[m - 1]} ${d}`;
    return day(`2000-${pad(m)}-${pad(d)}`, { year: false, format: f });
  }

  // Two dates as one span, sharing what they share:
  // "3–16 Mar 2026", "Mar 3–16, 2026", "03/03 – 16/03/2026".
  function range(a, b, opts = {}) {
    const pa = parts(a), pb = parts(b);
    if (!pa || !pb) return day(a || b, opts);
    const f = opts.format ? cleanFormat(opts.format) : dateFormat();
    const o = { ...opts, format: f };
    if (pa.y === pb.y && pa.m === pb.m && pa.d === pb.d) return day(a, o);
    const yr = opts.year === undefined ? true : opts.year === "auto" ? pb.y !== new Date().getFullYear() || pa.y !== pb.y : !!opts.year;
    if (pa.y !== pb.y || f === "iso") return day(a, { ...o, year: true }) + " – " + day(b, { ...o, year: true });
    if (f === "dmy" && pa.m === pb.m) return pa.d + "–" + day(b, { ...o, year: yr });
    if (f === "mdy" && pa.m === pb.m) return `${MONTHS[pa.m - 1]} ${pa.d}–${pb.d}` + (yr ? ", " + pb.y : "");
    return day(a, { ...o, year: false }) + " – " + day(b, { ...o, year: yr });
  }

  // A moment: the date, then the time on this device's clock.
  function dateTime(x, opts = {}) {
    const t = x instanceof Date ? x : new Date(x);
    if (x === null || x === undefined || x === "" || isNaN(t.getTime())) return "";
    return day(t, { year: opts.year === undefined ? "auto" : opts.year }) + ", " +
      t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // What the settings page shows for each choice, worked on one real date.
  const SAMPLE = "2026-11-03";
  const formatChoices = () => FORMATS.map((f) => ({ value: f, label: day(SAMPLE, { format: f }) }));
  const weekStartChoices = () => WEEK_STARTS.map((w) => ({ value: w, label: WEEKDAY_NAMES[w] }));

  const api = {
    bind, weekStart, dateFormat, cleanWeekStart, cleanFormat,
    weekOrder, weekPos, startOfWeek, workDays, weekendDays,
    day, dayMonth, range, dateTime, parts,
    formatChoices, weekStartChoices,
    WEEK_STARTS, FORMATS, WEEKDAYS, WEEKDAY_NAMES, MONTHS,
  };
  if (typeof window !== "undefined") window.LifeLogDates = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
