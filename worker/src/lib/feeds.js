// Reading a calendar feed (.ics), such as an iCloud calendar's share link, into a list of events.
// Repeating events are expanded within a window of dates; times in a named time zone are turned into UTC.
// An event comes back as { id, n, where, allDay, start, end }: all-day events use dates (YYYY-MM-DD, end
// exclusive), timed ones ISO times in UTC ("…Z"), or local wall time with no "Z" when the zone is unknown.

const MAX_INSTANCES = 4000; // per repeating event, counting from its first date

export function parseFeed(text, fromISO, toISO) {
  const lines = unfold(String(text || ""));
  if (!lines.some((l) => l === "BEGIN:VCALENDAR")) throw new Error("That link isn't a calendar.");
  let name = "", calTz = "";
  const raw = [];
  let cur = null, depth = 0;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = { props: {} }; depth = 0; continue; }
    if (cur && line.startsWith("BEGIN:")) { depth++; continue; } // VALARM and the like
    if (cur && line.startsWith("END:") && depth) { depth--; continue; }
    if (line === "END:VEVENT") { if (cur) raw.push(cur); cur = null; continue; }
    const p = prop(line);
    if (!p) continue;
    if (!cur) { if (p.name === "X-WR-CALNAME") name = unescapeText(p.value); if (p.name === "X-WR-TIMEZONE") calTz = p.value; continue; }
    if (depth) continue;
    if (p.name === "EXDATE") (cur.props.EXDATE = cur.props.EXDATE || []).push(p);
    else cur.props[p.name] = p;
  }

  const from = Date.parse(fromISO + "T00:00:00Z"), to = Date.parse(toISO + "T23:59:59Z");
  const overrides = new Map(); // uid -> set of instance keys replaced by their own VEVENT
  // dates are compared as the app would get them (UTC times, or dates), whatever zone each was written in
  const norm = (p, v) => { const d = readDate({ value: v, params: p.params }, calTz); return d ? toOut(d, d) : v; };
  raw.forEach((e) => { const r = e.props["RECURRENCE-ID"]; if (r && e.props.UID) { const u = e.props.UID.value; if (!overrides.has(u)) overrides.set(u, new Set()); overrides.get(u).add(norm(r, r.value)); } });

  const out = [];
  for (const e of raw) {
    const P = e.props;
    if (!P.DTSTART || (P.STATUS && P.STATUS.value === "CANCELLED")) continue;
    const start = readDate(P.DTSTART, calTz);
    if (!start) continue;
    let dur;
    if (P.DTEND) { const end = readDate(P.DTEND, calTz); dur = end ? wallMs(end) - wallMs(start) : 0; }
    else if (P.DURATION) dur = duration(P.DURATION.value);
    else dur = start.allDay ? 864e5 : 0;
    dur = Math.max(0, dur || 0);
    const base = { uid: P.UID ? P.UID.value : "", n: unescapeText(P.SUMMARY ? P.SUMMARY.value : "") || "Busy", where: unescapeText(P.LOCATION ? P.LOCATION.value : "") };
    const emit = (w) => {
      const s = toOut(w, start), endW = addWallMs(w, dur), en = toOut(endW, start);
      const sMs = start.allDay ? Date.parse(s + "T00:00:00Z") : Date.parse(start.tz === "float" ? s + "Z" : s);
      const eMs = start.allDay ? Date.parse(en + "T00:00:00Z") : Date.parse(start.tz === "float" ? en + "Z" : en);
      // keep what overlaps the window (a day's slack each side for time zones)
      if (eMs < from - 864e5 || sMs > to + 864e5) return;
      out.push({ id: `${base.uid}|${s}`, n: base.n, where: base.where, allDay: !!start.allDay, start: s, end: en });
    };
    if (P.RRULE && !P["RECURRENCE-ID"]) {
      const ex = new Set((P.EXDATE || []).flatMap((x) => x.value.split(",").map((v) => norm(x, v.trim()))));
      const own = overrides.get(base.uid) || new Set();
      expand(start, P.RRULE.value, to + 864e5, (w) => {
        const key = toOut(w, start);
        if (ex.has(key) || own.has(key)) return;
        emit(w);
      });
    } else emit(start);
  }
  out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return { name, events: out };
}

// ---------- the format ----------
function unfold(text) {
  const src = text.replace(/\r\n?/g, "\n").split("\n"), out = [];
  for (const l of src) { if ((l.startsWith(" ") || l.startsWith("\t")) && out.length) out[out.length - 1] += l.slice(1); else if (l) out.push(l); }
  return out;
}
function prop(line) {
  // NAME;PARAM=V;PARAM="a:b":value — a colon inside quotes isn't the separator
  let q = false, i = 0;
  for (; i < line.length; i++) { const c = line[i]; if (c === '"') q = !q; else if (c === ":" && !q) break; }
  if (i >= line.length) return null;
  const head = line.slice(0, i).split(";"), params = {};
  head.slice(1).forEach((p) => { const k = p.indexOf("="); if (k > 0) params[p.slice(0, k).toUpperCase()] = p.slice(k + 1).replace(/^"|"$/g, ""); });
  return { name: head[0].toUpperCase(), params, value: line.slice(i + 1) };
}
const unescapeText = (s) => String(s || "").replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

// A date as wall-clock parts plus how to read them: a named zone, UTC, or floating (the viewer's own time).
function readDate(p, calTz) {
  const v = p.value.trim();
  let m = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m || p.params.VALUE === "DATE") { m = m || v.match(/^(\d{4})(\d{2})(\d{2})/); if (!m) return null; return { y: +m[1], mo: +m[2], d: +m[3], h: 0, mi: 0, s: 0, allDay: true }; }
  m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const tz = m[7] ? "UTC" : validZone(p.params.TZID) || validZone(calTz) || "float";
  return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +(m[6] || 0), tz };
}
function validZone(tz) {
  if (!tz) return "";
  tz = tz.replace(/^\/+/, "");
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch (e) { return ""; }
}
function duration(v) {
  const m = String(v).match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const ms = (((+m[2] || 0) * 7 + (+m[3] || 0)) * 86400 + (+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0)) * 1000;
  return m[1] === "-" ? -ms : ms;
}

// ---------- wall time ----------
// Wall-clock parts are kept as a UTC timestamp of those same numbers, so date arithmetic ignores DST.
const wallMs = (w) => Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
const fromWall = (ms, like) => { const d = new Date(ms); return { ...like, y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() }; };
const addWallMs = (w, ms) => fromWall(wallMs(w) + ms, w);
const pad = (n, k = 2) => String(n).padStart(k, "0");

// what the app gets: a date, a UTC time, or a floating local time
function toOut(w, like) {
  if (like.allDay) return `${w.y}-${pad(w.mo)}-${pad(w.d)}`;
  const local = `${w.y}-${pad(w.mo)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}:${pad(w.s)}`;
  if (like.tz === "float") return local;
  if (like.tz === "UTC") return local + "Z";
  return new Date(zonedToUtc(w, like.tz)).toISOString().replace(/\.000Z$/, "Z");
}
function offsetAt(ms, tz) {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - ms;
}
function zonedToUtc(w, tz) {
  const guess = wallMs(w);
  let utc = guess - offsetAt(guess, tz);
  utc = guess - offsetAt(utc, tz); // settles across a DST change
  return utc;
}

// ---------- repeats ----------
const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
function expand(start, rule, untilMs, each) {
  const r = Object.fromEntries(rule.split(";").map((x) => x.split("=")).filter((x) => x.length === 2).map(([k, v]) => [k.toUpperCase(), v]));
  const freq = r.FREQ, step = Math.max(1, +r.INTERVAL || 1), count = +r.COUNT || 0;
  let until = Infinity;
  if (r.UNTIL) { const u = readDate({ value: r.UNTIL, params: {} }, ""); if (u) until = wallMs(u) + (u.allDay ? 864e5 - 1 : 0); }
  const byDay = (r.BYDAY || "").split(",").filter(Boolean).map((x) => { const m = x.match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/); return m ? { n: m[1] ? +m[1] : 0, wd: DAYS.indexOf(m[2]) } : null; }).filter(Boolean);
  const byMonthDay = (r.BYMONTHDAY || "").split(",").filter(Boolean).map(Number);
  const byMonth = (r.BYMONTH || "").split(",").filter(Boolean).map(Number);
  const t0 = wallMs(start), timeOfDay = t0 % 864e5;
  let n = 0;
  const take = (ms) => { if (ms < t0) return true; if (ms > until || ms > untilMs) return false; if (count && n >= count) return false; n++; each(fromWall(ms, start)); return true; };
  const stop = () => n >= MAX_INSTANCES || (count && n >= count);
  const dayMs = (y, mo, d) => Date.UTC(y, mo - 1, d) + timeOfDay;
  const dim = (y, mo) => new Date(Date.UTC(y, mo, 0)).getUTCDate();
  // days in a month matching BYDAY (with ordinals like 2TU or -1FR)
  const monthDays = (y, mo) => {
    const len = dim(y, mo), out = [];
    if (byMonthDay.length) byMonthDay.forEach((d) => { const x = d < 0 ? len + 1 + d : d; if (x >= 1 && x <= len) out.push(x); });
    else if (byDay.length) byDay.forEach(({ n: k, wd }) => {
      const all = []; for (let d = 1; d <= len; d++) if (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() === wd) all.push(d);
      if (!k) out.push(...all); else { const x = k > 0 ? all[k - 1] : all[all.length + k]; if (x) out.push(x); }
    });
    else if (start.d <= len) out.push(start.d);
    return [...new Set(out)].sort((a, b) => a - b);
  };

  if (freq === "DAILY") {
    for (let ms = t0, g = 0; g < MAX_INSTANCES * 4 && !stop(); ms += step * 864e5, g++) {
      if (byDay.length && !byDay.some((b) => b.wd === new Date(ms).getUTCDay())) continue;
      if (!take(ms)) break;
    }
  } else if (freq === "WEEKLY") {
    const days = (byDay.length ? byDay.map((b) => b.wd) : [new Date(t0).getUTCDay()]).sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // weeks start Monday
    const wk0 = t0 - timeOfDay - ((new Date(t0).getUTCDay() + 6) % 7) * 864e5;
    outer: for (let w = wk0, g = 0; g < MAX_INSTANCES && !stop(); w += step * 7 * 864e5, g++)
      for (const wd of days) { const ms = w + ((wd + 6) % 7) * 864e5 + timeOfDay; if (ms < t0) continue; if (!take(ms) || stop()) break outer; }
  } else if (freq === "MONTHLY") {
    outer: for (let k = 0; k < MAX_INSTANCES && !stop(); k += step) {
      const mo0 = start.mo - 1 + k, y = start.y + Math.floor(mo0 / 12), mo = (mo0 % 12) + 1;
      if (dayMs(y, mo, 1) > untilMs) break;
      for (const d of monthDays(y, mo)) if (!take(dayMs(y, mo, d)) || stop()) break outer;
    }
  } else if (freq === "YEARLY") {
    const months = byMonth.length ? byMonth : [start.mo];
    outer: for (let k = 0; k < 400 && !stop(); k += step) {
      const y = start.y + k;
      if (dayMs(y, 1, 1) > untilMs) break;
      for (const mo of months) {
        const ds = byDay.length || byMonthDay.length ? monthDays(y, mo) : start.d <= dim(y, mo) ? [start.d] : [];
        for (const d of ds) if (!take(dayMs(y, mo, d)) || stop()) break outer;
      }
    }
  } else take(t0);
}

// ---------- fetching ----------
const MAX_BYTES = 6 * 1024 * 1024;
export async function readFeeds(urls, fromISO, toISO) {
  const list = (Array.isArray(urls) ? urls : []).map((u) => String(u || "").trim()).filter(Boolean).slice(0, 12);
  return Promise.all(list.map(async (u) => {
    try {
      const url = new URL(u.replace(/^webcals?:\/\//i, "https://"));
      if (url.protocol !== "https:") throw new Error("Use an https or webcal link.");
      const res = await fetch(url.toString(), { headers: { Accept: "text/calendar, */*" }, redirect: "follow", cf: { cacheTtl: 300 } });
      if (!res.ok) throw new Error(res.status === 404 ? "That calendar link wasn't found. Is the calendar still shared?" : `The calendar server said ${res.status}.`);
      const len = +res.headers.get("content-length") || 0;
      if (len > MAX_BYTES) throw new Error("That calendar is too big to read.");
      const text = await res.text();
      if (text.length > MAX_BYTES) throw new Error("That calendar is too big to read.");
      const { name, events } = parseFeed(text, fromISO, toISO);
      return { url: u, name, events };
    } catch (e) {
      return { url: u, error: e.message || "Couldn't read that calendar." };
    }
  }));
}
