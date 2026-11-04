// Tasks, kept in the Planner Tasks database (TASKS_DB). The app sends what changed in batches and reads the
// whole list back; Notion is the copy every device shares.
//
// A task in the app: { id (Notion page id), n, due (YYYY-MM-DD), at (HH:MM), list, rep, pri, notes, done,
//                      fu ("" | "days" | "date"), fuN, fuOn, fuCount, fuLast }
import { notion, dataSourceId, queryAll, text, richText, numOrNull, checkbox, select } from "./lib/notion.js";

const REPEATS = { "": "None", daily: "Daily", weekly: "Weekly", monthly: "Monthly" };
const FOLLOWS = { "": "None", days: "Every few days", date: "Once on a date" };
const PRIORITIES = ["High", "Medium", "Low"];
const MAX_CHANGES = 20;
const DONE_DAYS = 30; // finished tasks older than this aren't sent to the app
const back = (map, v) => Object.keys(map).find((k) => map[k] === v) || "";
const day = (p) => (p && p.date && p.date.start ? String(p.date.start).slice(0, 10) : "");
const clip = (s, n) => String(s == null ? "" : s).slice(0, n);
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || "");

export async function listTasks(env) {
  const ds = await dataSourceId(env, env.TASKS_DB);
  const since = new Date(Date.now() - DONE_DAYS * 864e5).toISOString();
  const pages = await queryAll(env, ds, {
    filter: { or: [{ property: "Done", checkbox: { equals: false } }, { timestamp: "last_edited_time", last_edited_time: { on_or_after: since } }] },
  });
  return pages.filter((p) => !p.in_trash && !p.archived).map(fromPage).filter((t) => t.n);
}

function fromPage(p) {
  const pr = p.properties || {}, due = pr["Due"] && pr["Due"].date ? String(pr["Due"].date.start) : "";
  // a time on Due is the reminder; it's read as the wall-clock time it was written in
  const at = /T(\d{2}:\d{2})/.exec(due);
  return {
    id: p.id, url: p.url, n: text(pr["Title"]).trim(), due: due.slice(0, 10), at: at ? at[1] : "",
    list: select(pr["Category"]) || "Personal", rep: back(REPEATS, select(pr["Repeat"])), pri: select(pr["Priority"]),
    notes: text(pr["Notes"]).trim(), done: checkbox(pr["Done"]),
    fu: back(FOLLOWS, select(pr["Follow up"])), fuN: numOrNull(pr["Follow up days"]) || 3, fuOn: day(pr["Follow up on"]),
    fuCount: numOrNull(pr["Followed up"]) || 0, fuLast: day(pr["Last followed up"]), edited: p.last_edited_time,
  };
}

function clean(t, needId) {
  if (!t || typeof t !== "object") return null;
  const id = String(t.id || "").replace(/-/g, "");
  if (needId && !/^[0-9a-f]{32}$/i.test(id)) return null;
  const n = clip(t.n, 200).trim();
  if (!n) return null;
  return {
    id, ref: clip(t.ref, 64), n, due: isDay(t.due) ? t.due : "", at: /^\d{2}:\d{2}$/.test(t.at || "") ? t.at : "",
    list: clip(t.list, 60).replace(/,/g, " ").trim(), rep: t.rep in REPEATS ? t.rep : "", pri: PRIORITIES.includes(t.pri) ? t.pri : "",
    notes: clip(t.notes, 2000), done: !!t.done, fu: t.fu in FOLLOWS ? t.fu : "",
    fuN: Math.min(365, Math.max(1, Math.round(+t.fuN || 3))), fuOn: isDay(t.fuOn) ? t.fuOn : "",
    fuCount: Math.max(0, Math.round(+t.fuCount || 0)), fuLast: isDay(t.fuLast) ? t.fuLast : "",
    tz: clip(t.tz, 60),
  };
}

function props(t) {
  const dateOf = (d) => (d ? { date: { start: d } } : { date: null });
  // with a reminder time, Due holds the date and time in the person's own time zone
  const due = !t.due ? { date: null } : t.at ? { date: { start: `${t.due}T${t.at}:00`, time_zone: t.tz || "America/New_York" } } : { date: { start: t.due } };
  return {
    Title: { title: richText(t.n) }, Due: due, Category: t.list ? { select: { name: t.list } } : { select: null },
    Repeat: { select: { name: REPEATS[t.rep] } }, Priority: t.pri ? { select: { name: t.pri } } : { select: null },
    Notes: { rich_text: richText(t.notes) }, Done: { checkbox: t.done },
    "Follow up": { select: { name: FOLLOWS[t.fu] } }, "Follow up days": { number: t.fu === "days" ? t.fuN : null },
    "Follow up on": dateOf(t.fu === "date" ? t.fuOn : ""), "Followed up": { number: t.fuCount || null }, "Last followed up": dateOf(t.fuLast),
  };
}

export async function writeTasks(env, body) {
  const creates = Array.isArray(body.creates) ? body.creates : [], updates = Array.isArray(body.updates) ? body.updates : [];
  const deletes = Array.isArray(body.deletes) ? body.deletes : [];
  if (creates.length + updates.length + deletes.length > MAX_CHANGES)
    return { created: [], ok: [], failed: [{ ref: "", message: `Send at most ${MAX_CHANGES} changes per request.` }] };
  const created = [], ok = [], failed = [];
  const jobs = [
    ...creates.map((c) => ({ kind: "create", t: clean(c, false), ref: clip(c && c.ref, 64) })),
    ...updates.map((u) => ({ kind: "update", t: clean(u, true), ref: clip(u && u.id, 64) })),
    ...deletes.map((d) => { const id = String(d || "").replace(/-/g, ""); return { kind: "delete", id: /^[0-9a-f]{32}$/i.test(id) ? id : null, ref: clip(d, 64) }; }),
  ];
  const ds = jobs.some((j) => j.kind === "create" && j.t) ? await dataSourceId(env, env.TASKS_DB) : null;
  const queue = jobs.slice();
  const run = async () => {
    while (queue.length) {
      const j = queue.shift();
      if (j.kind === "delete" ? !j.id : !j.t) { failed.push({ ref: j.ref, message: "Invalid task." }); continue; }
      try {
        if (j.kind === "create") {
          const page = await notion(env, "/pages", "POST", { parent: { type: "data_source_id", data_source_id: ds }, properties: props(j.t) });
          created.push({ ref: j.t.ref, id: page.id });
        } else if (j.kind === "update") { await notion(env, `/pages/${j.t.id}`, "PATCH", { properties: props(j.t) }); ok.push(j.t.id); }
        else { await notion(env, `/pages/${j.id}`, "PATCH", { in_trash: true }); ok.push(j.id); }
      } catch (e) { failed.push({ ref: j.ref, message: e.message || "Notion request failed." }); }
    }
  };
  await Promise.all([run(), run()]);
  return { created, ok, failed };
}
