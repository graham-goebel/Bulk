// Gain Planner API
// A small Cloudflare Worker that sits between the web app and Notion.
// It keeps your Notion token secret and checks a passcode on every request.
//
// Endpoints (all need the X-Passcode header):
//   GET  /meals              -> { meals: [...] }        the meal library, with nutrients,
//                                                       food groups and diversity score
//   GET  /plan?from=YYYY-MM-DD -> { rows: [...] }       planned meals from that date on
//        Each row's "time" is the wall-clock time (HH:MM) it was planned for, so devices in
//        different time zones agree; "when" is the same moment as a full date for Notion's calendar.
//   POST /plan/batch         -> { ok: [keys], failed: [{key, message}] }
//        body: { creates: [item], updates: [item + id], deletes: [{id, key}] }  (max 20 in total)
//        Planned meals are keyed "YYYY-MM-DD <slot number>"; meals added by hand are "YYYY-MM-DD c<id>"
//        in the Custom slot, and are the only rows that can be deleted. "extras" is JSON the app keeps
//        on the row: pantry add-ons for a planned meal, or a custom meal's macros.
//   GET  /pantry             -> { items: [...] }        what's in the fridge, freezer and pantry
//   POST /pantry/batch       -> { created: [{ref, id, url}], ok: [ids], failed: [{ref, message}] }
//        body: { creates: [item + ref], updates: [item + id], deletes: [id] }  (max 20 in total)
//   GET  /product?url=...    -> { title, image, images: [...], nutrition, nutritionText, note? }  reads a store's product page;
//        if the store blocks it (Walmart shows bots a "Robot or human?" page), searches Open Food Facts by the name in the link
//   GET  /img?url=...        -> the image itself, with CORS so the app can cut out its background
//   GET  /ics?e=...          -> a calendar file (text/calendar) with alerts, for meal reminders.
//        No passcode: it only echoes the titles and times it's given and reads nothing from Notion.
//   GET  /health             -> { ok: true }
//
// Optional history cleanup: when KEEP_WEEKS is set above 0, a daily cron moves
// Meal Plan rows older than that many weeks to Notion's trash (restorable for 30 days).

//
// Reusable pieces live in lib/: notion.js (Notion client), http.js (CORS, JSON, secrets),
// product.js (store pages, Open Food Facts, image proxy) and ics.js (calendar files).

import { notion, dataSourceId, queryAll, patchPage, isPageId, text, richText, num, numOrNull, lines } from "./lib/notion.js";
import { cors as corsFor, jsonResponse, readJson, sameSecret } from "./lib/http.js";
import { readProduct, proxyImage, webUrl } from "./lib/product.js";
import { icsResponse } from "./lib/ics.js";

const SLOTS = ["Breakfast", "Morning snack", "Lunch", "Afternoon snack", "Dinner", "Before bed"];
const MAX_ITEMS = 20;
const LOCATIONS = ["Fridge", "Freezer", "Pantry"];
// Per-serving nutrition columns in the Pantry database, keyed by the name the app uses.
const PANTRY_NUTRITION = { servings: "Servings", calories: "Calories", protein: "Protein (g)", carbs: "Carbs (g)", fat: "Fat (g)",
  fiber: "Fiber (g)", sugar: "Sugar (g)", sodium: "Sodium (mg)" };
const CATEGORIES = ["Produce", "Dairy & eggs", "Meat & fish", "Grains & bread", "Cans & jars", "Nuts & snacks", "Oils & sauces", "Frozen", "Drinks", "Other"];
const CLEANUP_PER_RUN = 40; // stays under the free plan's 50 subrequests per invocation

export default {
  async fetch(request, env) {
    const { ok: originOk, origin, headers: cors } = corsFor(request, env.ALLOWED_ORIGINS);
    const json = jsonResponse(cors);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method === "GET" && url.pathname === "/ics") return icsResponse(url.searchParams.get("e"));
    if (!originOk) return json({ error: "origin_not_allowed", message: `Add ${origin} to ALLOWED_ORIGINS.` }, 403);
    if (!env.NOTION_TOKEN || !env.APP_PASSCODE || !env.MEALS_DB || !env.PLAN_DB)
      return json({ error: "server_not_configured", message: "Set NOTION_TOKEN, APP_PASSCODE, MEALS_DB and PLAN_DB." }, 500);
    if (!(await sameSecret(request.headers.get("X-Passcode") || "", env.APP_PASSCODE)))
      return json({ error: "bad_passcode", message: "Wrong passcode." }, 401);

    const route = (method, path) => request.method === method && url.pathname === path;
    // POST bodies are JSON; a meal endpoint needs the meal's page id
    const body = async () => { const b = await readJson(request); if (b === undefined) throw badRequest("Body must be JSON."); return b || {}; };
    const mealId = (b) => { if (!isPageId(b.id)) throw badRequest("A meal id is required."); return b.id; };
    try {
      if (route("GET", "/health")) return json({ ok: true });
      if (route("GET", "/meals")) return json({ meals: await listMeals(env) });
      if (route("GET", "/plan")) return json({ rows: await listPlan(env, url.searchParams.get("from")) });
      if (route("GET", "/product")) return json(await readProduct(url.searchParams.get("url")));
      if (route("GET", "/img")) return await proxyImage(url.searchParams.get("url"), cors);
      if (url.pathname === "/pantry" || url.pathname === "/pantry/batch") {
        if (!env.PANTRY_DB) return json({ error: "server_not_configured", message: "Set PANTRY_DB." }, 500);
        if (route("GET", "/pantry")) return json({ items: await listPantry(env) });
        if (route("POST", "/pantry/batch")) return json(await writePantry(env, await body()));
      }
      // a recipe "deleted" in the app is hidden from the planner in Notion, so it can be brought back
      if (route("POST", "/meals/hide")) { const b = await body(); await patchPage(env, mealId(b), { "Hide from planner": { checkbox: !!b.hide } }); return json({ ok: true }); }
      // favorites are kept on the recipe so every browser and the home-screen app share them
      if (route("POST", "/meals/fav")) { const b = await body(); await patchPage(env, mealId(b), { Favorite: { checkbox: !!b.fav } }); return json({ ok: true }); }
      // an ingredient taken out of a recipe in the app: its new ingredient list, macros and nutrients
      if (route("POST", "/meals/update")) { const b = await body(); await patchPage(env, mealId(b), mealUpdateProps(b)); return json({ ok: true }); }
      if (route("POST", "/plan/batch")) return json(await writePlan(env, await body()));
      return json({ error: "not_found" }, 404);
    } catch (e) {
      if (e.badRequest) return json({ error: "bad_request", message: e.message }, 400);
      if (e.fetchError) return json({ error: "fetch_failed", message: e.message }, 422);
      const status = e.status || 0;
      const code = status === 401 ? "notion_token" : status === 403 || status === 404 ? "notion_access" : "notion_error";
      return json({ error: code, message: e.message || "Notion request failed." }, 502);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanupHistory(env).then((r) => console.log(`history cleanup: ${JSON.stringify(r)}`)));
  },
};

function badRequest(message) { const e = new Error(message); e.badRequest = true; return e; }

// Micronutrient columns in the Meals database, keyed by the name the app uses.
const NUTRIENTS = {
  fiber: "Fiber (g)", iron: "Iron (mg)", zinc: "Zinc (mg)", calcium: "Calcium (mg)", magnesium: "Magnesium (mg)",
  potassium: "Potassium (mg)", vitd: "Vitamin D (mcg)", b12: "Vitamin B12 (mcg)", folate: "Folate (mcg)",
  vitc: "Vitamin C (mg)", omega3: "Omega-3 (g)",
};

function mealUpdateProps(b) {
  const n = (v) => { const x = +v; return Number.isFinite(x) && x >= 0 && x <= 100000 ? Math.round(x * 100) / 100 : null; };
  const ing = (Array.isArray(b.ingredients) ? b.ingredients : []).map((x) => String(x || "").trim().slice(0, 200)).filter(Boolean).slice(0, 60);
  const props = {
    Ingredients: { rich_text: richText(ing.join("\n")) },
    Calories: { number: n(b.calories) }, "Protein (g)": { number: n(b.protein) }, "Carbs (g)": { number: n(b.carbs) }, "Fat (g)": { number: n(b.fat) },
  };
  if (b.nutrients && typeof b.nutrients === "object")
    Object.entries(NUTRIENTS).forEach(([k, col]) => { if (k in b.nutrients) props[col] = { number: b.nutrients[k] == null ? null : n(b.nutrients[k]) }; });
  return props;
}

// ---------- meals and the plan ----------
async function listMeals(env) {
  const ds = await dataSourceId(env, env.MEALS_DB);
  const pages = await queryAll(env, ds, {});
  return pages
    .filter((p) => !p.in_trash && !p.archived)
    .map((p) => {
      const pr = p.properties || {};
      return {
        id: p.id,
        url: p.url,
        name: text(pr["Name"]).trim(),
        slot: pr["Slot"] && pr["Slot"].select ? pr["Slot"].select.name : "",
        calories: num(pr["Calories"]),
        protein: num(pr["Protein (g)"]),
        carbs: num(pr["Carbs (g)"]),
        fat: num(pr["Fat (g)"]),
        description: text(pr["Description"]),
        ingredients: lines(text(pr["Ingredients"])),
        steps: lines(text(pr["Steps"])),
        hide: !!(pr["Hide from planner"] && pr["Hide from planner"].checkbox),
        fav: pr["Favorite"] ? !!pr["Favorite"].checkbox : null, // null until the database has a Favorite column
        nutrients: Object.fromEntries(Object.entries(NUTRIENTS).map(([k, col]) => [k, numOrNull(pr[col])])),
        groups: pr["Food groups"] && Array.isArray(pr["Food groups"].multi_select) ? pr["Food groups"].multi_select.map((o) => o.name) : [],
        prep: numOrNull(pr["Prep (min)"]), // optional; the app estimates from the steps when it's empty
        diversity: pr["Diversity score"] && pr["Diversity score"].formula && typeof pr["Diversity score"].formula.number === "number"
          ? pr["Diversity score"].formula.number : null,
      };
    })
    .filter((m) => m.name && SLOTS.includes(m.slot));
}

async function listPlan(env, from) {
  const ds = await dataSourceId(env, env.PLAN_DB);
  const query = { sorts: [{ property: "When", direction: "ascending" }] };
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) query.filter = { property: "When", date: { on_or_after: from } };
  const pages = await queryAll(env, ds, query);
  return pages
    .filter((p) => !p.in_trash && !p.archived)
    .map((p) => {
      const pr = p.properties || {};
      return {
        id: p.id,
        url: p.url,
        key: text(pr["Key"]).trim(),
        meal: text(pr["Meal"]).trim(),
        when: pr["When"] && pr["When"].date ? pr["When"].date.start : null,
        time: text(pr["Time"]).trim(),
        locked: !!(pr["Locked"] && pr["Locked"].checkbox),
        eaten: !!(pr["Eaten"] && pr["Eaten"].checkbox),
        skipped: !!(pr["Skipped"] && pr["Skipped"].checkbox),
        extras: text(pr["Extras"]),
      };
    })
    .filter((r) => r.key);
}

function toProperties(item) {
  return {
    Meal: { title: [{ text: { content: item.meal } }] },
    When: { date: { start: item.when } },
    Slot: { select: { name: item.slot } },
    Calories: { number: item.calories },
    "Protein (g)": { number: item.protein },
    Locked: { checkbox: item.locked },
    Eaten: { checkbox: item.eaten },
    Skipped: { checkbox: item.skipped },
    Key: { rich_text: [{ text: { content: item.key } }] },
    Time: { rich_text: item.time ? [{ text: { content: item.time } }] : [] },
    Extras: { rich_text: richText(item.extras) },
  };
}

function cleanItem(raw, needId) {
  if (!raw || typeof raw !== "object") return null;
  const item = {
    key: String(raw.key || "").slice(0, 40),
    meal: String(raw.meal || "").slice(0, 200),
    when: String(raw.when || ""),
    slot: String(raw.slot || ""),
    calories: Number.isFinite(+raw.calories) ? +raw.calories : 0,
    protein: Number.isFinite(+raw.protein) ? +raw.protein : 0,
    locked: !!raw.locked,
    eaten: !!raw.eaten,
    skipped: !!raw.skipped && !raw.eaten,
    time: /^\d{2}:\d{2}$/.test(String(raw.time || "")) ? String(raw.time) : "",
    // JSON the app keeps with the row: pantry add-ons for a planned meal, or a custom meal's macros
    extras: typeof raw.extras === "string" ? raw.extras.slice(0, 6000) : "",
  };
  // Planned meals are keyed "date slot-number"; meals added by hand are "date c<id>" in the Custom slot.
  const custom = /^\d{4}-\d{2}-\d{2} c[a-z0-9]{4,20}$/.test(item.key);
  if (!(custom ? item.slot === "Custom" : /^\d{4}-\d{2}-\d{2} \d$/.test(item.key) && SLOTS.includes(item.slot)) || !item.meal) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/.test(item.when)) return null;
  if (needId) {
    item.id = String(raw.id || "").replace(/-/g, "");
    if (!/^[0-9a-f]{32}$/i.test(item.id)) return null;
  }
  return item;
}

async function writePlan(env, body) {
  const creates = Array.isArray(body.creates) ? body.creates : [];
  const updates = Array.isArray(body.updates) ? body.updates : [];
  const deletes = Array.isArray(body.deletes) ? body.deletes : [];
  if (creates.length + updates.length + deletes.length > MAX_ITEMS) {
    return { ok: [], failed: [{ key: "", message: `Send at most ${MAX_ITEMS} changes per request.` }] };
  }
  // Only custom meals are ever deleted; planned slots are kept and changed instead.
  const delItem = (d) => {
    const id = String((d && d.id) || "").replace(/-/g, ""), key = String((d && d.key) || "");
    return /^[0-9a-f]{32}$/i.test(id) && /^\d{4}-\d{2}-\d{2} c[a-z0-9]{4,20}$/.test(key) ? { id, key } : null;
  };
  const jobs = [
    ...creates.map((c) => ({ kind: "create", item: cleanItem(c, false), key: c && c.key })),
    ...updates.map((u) => ({ kind: "update", item: cleanItem(u, true), key: u && u.key })),
    ...deletes.map((d) => ({ kind: "delete", item: delItem(d), key: d && d.key })),
  ];
  const ok = [], failed = [];
  let ds = null;
  if (jobs.some((j) => j.kind === "create" && j.item)) ds = await dataSourceId(env, env.PLAN_DB);

  // Two at a time keeps well under Notion's rate limit.
  const queue = jobs.slice();
  const worker = async () => {
    while (queue.length) {
      const job = queue.shift();
      if (!job.item) { failed.push({ key: String(job.key || ""), message: "Invalid item." }); continue; }
      try {
        if (job.kind === "create") {
          await notion(env, "/pages", "POST", { parent: { type: "data_source_id", data_source_id: ds }, properties: toProperties(job.item) });
        } else if (job.kind === "delete") {
          await notion(env, `/pages/${job.item.id}`, "PATCH", { in_trash: true });
        } else {
          await notion(env, `/pages/${job.item.id}`, "PATCH", { properties: toProperties(job.item) });
        }
        ok.push(job.item.key);
      } catch (e) {
        failed.push({ key: job.item.key, message: e.message || "Notion request failed." });
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return { ok, failed };
}

// ---------- history cleanup ----------
async function cleanupHistory(env, now = new Date()) {
  const weeks = Math.floor(Number(env.KEEP_WEEKS) || 0);
  if (weeks <= 0 || !env.NOTION_TOKEN || !env.PLAN_DB) return { skipped: true };
  const cutoff = new Date(now.getTime() - weeks * 7 * 86400000).toISOString().slice(0, 10);
  const ds = await dataSourceId(env, env.PLAN_DB);
  const page = await notion(env, `/data_sources/${ds}/query`, "POST", {
    page_size: CLEANUP_PER_RUN,
    filter: { property: "When", date: { before: cutoff } },
    sorts: [{ property: "When", direction: "ascending" }],
  });
  const old = page.results.filter((p) => !p.in_trash && !p.archived);
  let trashed = 0, failed = 0;
  const queue = old.slice();
  const worker = async () => {
    while (queue.length) {
      const p = queue.shift();
      try { await notion(env, `/pages/${p.id}`, "PATCH", { in_trash: true }); trashed++; } catch { failed++; }
    }
  };
  await Promise.all([worker(), worker()]);
  return { cutoff, trashed, failed, more: !!page.has_more };
}

// ---------- pantry ----------
async function listPantry(env) {
  const ds = await dataSourceId(env, env.PANTRY_DB);
  const pages = await queryAll(env, ds, { sorts: [{ property: "Name", direction: "ascending" }] });
  return pages
    .filter((p) => !p.in_trash && !p.archived)
    .map((p) => {
      const pr = p.properties || {};
      const sel = (x) => (x && x.select ? x.select.name : "");
      return {
        id: p.id,
        url: p.url,
        name: text(pr["Name"]).trim(),
        location: LOCATIONS.includes(sel(pr["Location"])) ? sel(pr["Location"]) : "Pantry",
        category: CATEGORIES.includes(sel(pr["Category"])) ? sel(pr["Category"]) : "Other",
        quantity: numOrNull(pr["Quantity"]),
        unit: text(pr["Unit"]).trim(),
        full: numOrNull(pr["Full amount"]), // how much a full container holds, so "running low" is relative to it
        expires: pr["Expires"] && pr["Expires"].date ? String(pr["Expires"].date.start).slice(0, 10) : "",
        link: (pr["Link"] && pr["Link"].url) || "",
        image: (pr["Image"] && pr["Image"].url) || "",
        serving: text(pr["Serving size"]).trim(),
        recipes: text(pr["Recipes"]).split("\n").map((x) => x.trim()).filter(Boolean),
        nutrition: Object.fromEntries(Object.entries(PANTRY_NUTRITION).map(([k, col]) => [k, numOrNull(pr[col])])),
      };
    })
    .filter((it) => it.name);
}

function cleanPantry(raw, needId) {
  if (!raw || typeof raw !== "object") return null;
  const q = raw.quantity === null || raw.quantity === "" || raw.quantity === undefined ? null : +raw.quantity;
  const it = {
    ref: String(raw.ref || "").slice(0, 40),
    name: String(raw.name || "").trim().slice(0, 100),
    location: LOCATIONS.includes(raw.location) ? raw.location : "Pantry",
    category: CATEGORIES.includes(raw.category) ? raw.category : "Other",
    quantity: q === null ? null : Number.isFinite(q) && q >= 0 && q <= 9999 ? Math.round(q * 100) / 100 : null,
    unit: String(raw.unit || "").trim().slice(0, 20),
    full: (() => { const f = raw.full === null || raw.full === "" || raw.full === undefined ? null : +raw.full; return Number.isFinite(f) && f > 0 && f <= 9999 ? Math.round(f * 100) / 100 : null; })(),
    expires: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.expires || "")) ? String(raw.expires) : "",
    link: webUrl(raw.link),
    image: webUrl(raw.image),
    serving: String(raw.serving || "").trim().slice(0, 60),
    recipes: (Array.isArray(raw.recipes) ? raw.recipes : []).map((x) => String(x || "").replace(/\s+/g, " ").trim().slice(0, 200)).filter(Boolean).slice(0, 40),
    nutrition: Object.fromEntries(Object.keys(PANTRY_NUTRITION).map((k) => {
      const v = raw.nutrition && raw.nutrition[k];
      const n = v === null || v === undefined || v === "" ? null : +v;
      return [k, Number.isFinite(n) && n >= 0 && n <= 100000 ? Math.round(n * 10) / 10 : null];
    })),
  };
  if (!it.name) return null;
  if (needId) {
    it.id = String(raw.id || "").replace(/-/g, "");
    if (!/^[0-9a-f]{32}$/i.test(it.id)) return null;
  }
  return it;
}

function pantryProps(it) {
  return {
    Name: { title: [{ text: { content: it.name } }] },
    Location: { select: { name: it.location } },
    Category: { select: { name: it.category } },
    Quantity: { number: it.quantity },
    Unit: { rich_text: it.unit ? [{ text: { content: it.unit } }] : [] },
    "Full amount": { number: it.full },
    Expires: { date: it.expires ? { start: it.expires } : null },
    Link: { url: it.link || null },
    Image: { url: it.image || null },
    "Serving size": { rich_text: it.serving ? [{ text: { content: it.serving } }] : [] },
    Recipes: { rich_text: richText(it.recipes.join("\n")) },
    ...Object.fromEntries(Object.entries(PANTRY_NUTRITION).map(([k, col]) => [col, { number: it.nutrition[k] }])),
  };
}

async function writePantry(env, body) {
  const creates = Array.isArray(body.creates) ? body.creates : [];
  const updates = Array.isArray(body.updates) ? body.updates : [];
  const deletes = Array.isArray(body.deletes) ? body.deletes : [];
  if (creates.length + updates.length + deletes.length > MAX_ITEMS) {
    return { created: [], ok: [], failed: [{ ref: "", message: `Send at most ${MAX_ITEMS} changes per request.` }] };
  }
  const created = [], ok = [], failed = [];
  const jobs = [
    ...creates.map((c) => ({ kind: "create", it: cleanPantry(c, false), ref: String((c && c.ref) || "") })),
    ...updates.map((u) => ({ kind: "update", it: cleanPantry(u, true), ref: String((u && u.id) || "") })),
    ...deletes.map((d) => { const id = String(d || "").replace(/-/g, ""); return { kind: "delete", id: /^[0-9a-f]{32}$/i.test(id) ? id : null, ref: String(d || "") }; }),
  ];
  let ds = null;
  if (jobs.some((j) => j.kind === "create" && j.it)) ds = await dataSourceId(env, env.PANTRY_DB);
  const queue = jobs.slice();
  const worker = async () => {
    while (queue.length) {
      const j = queue.shift();
      if (j.kind === "delete" ? !j.id : !j.it) { failed.push({ ref: j.ref, message: "Invalid item." }); continue; }
      try {
        if (j.kind === "create") {
          const page = await notion(env, "/pages", "POST", { parent: { type: "data_source_id", data_source_id: ds }, properties: pantryProps(j.it) });
          created.push({ ref: j.it.ref, id: page.id, url: page.url });
        } else if (j.kind === "update") {
          await notion(env, `/pages/${j.it.id}`, "PATCH", { properties: pantryProps(j.it) });
          ok.push(j.it.id);
        } else {
          await notion(env, `/pages/${j.id}`, "PATCH", { in_trash: true });
          ok.push(j.id);
        }
      } catch (e) {
        failed.push({ ref: j.ref, message: e.message || "Notion request failed." });
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return { created, ok, failed };
}
