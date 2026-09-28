// Calendar reminders as an .ics file, built from a compact link parameter so it needs no storage.
// e = base64url JSON: [{ u: uid, t: title, d: "YYYYMMDDTHHMM" (local wall time), m: minutes long, n: notes, a: alert minutes before }]
export function icsResponse(e, { name = "Gain planner", product = "Meal reminders", file = "meal-reminder.ics" } = {}) {
  let events;
  try {
    const b64 = String(e || "").replace(/-/g, "+").replace(/_/g, "/");
    events = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
  } catch { return new Response("Bad reminder link.", { status: 400 }); }
  if (!Array.isArray(events) || !events.length || events.length > 12) return new Response("Bad reminder link.", { status: 400 });
  const esc = (v) => String(v || "").slice(0, 200).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const fold = (line) => { const out = []; let rest = line; while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = " " + rest.slice(74); } out.push(rest); return out.join("\r\n"); };
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${name}//${product}//EN`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const ev of events) {
    if (!ev || !/^\d{8}T\d{4}$/.test(ev.d)) return new Response("Bad reminder link.", { status: 400 });
    const y = +ev.d.slice(0, 4), mo = +ev.d.slice(4, 6) - 1, da = +ev.d.slice(6, 8), h = +ev.d.slice(9, 11), mi = +ev.d.slice(11, 13);
    const dur = Math.max(5, Math.min(240, Math.round(+ev.m || 30))), end = new Date(Date.UTC(y, mo, da, h, mi + dur));
    const p2 = (n) => String(n).padStart(2, "0");
    // floating times (no zone), so the phone reads them as its own local time
    const endStr = `${end.getUTCFullYear()}${p2(end.getUTCMonth() + 1)}${p2(end.getUTCDate())}T${p2(end.getUTCHours())}${p2(end.getUTCMinutes())}00`;
    const alert = Math.max(0, Math.min(720, Math.round(+ev.a || 0)));
    lines.push("BEGIN:VEVENT", `UID:${String(ev.u || ev.d).replace(/[^\w.-]/g, "").slice(0, 60)}@${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, `DTSTAMP:${stamp}`,
      `DTSTART:${ev.d}00`, `DTEND:${endStr}`, fold(`SUMMARY:${esc(ev.t)}`), fold(`DESCRIPTION:${esc(ev.n)}`),
      "BEGIN:VALARM", "ACTION:DISPLAY", fold(`DESCRIPTION:${esc(ev.t)}`), `TRIGGER:${alert ? `-PT${alert}M` : "PT0M"}`, "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.join("\r\n") + "\r\n", { headers: {
    "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `inline; filename="${file}"`, "Cache-Control": "no-store" } });
}
