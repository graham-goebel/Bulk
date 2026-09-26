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
//        body: { creates: [item], updates: [item + id] }  (max 20 items per call)
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

const NOTION_VERSION = "2025-09-03";
const NOTION_API = "https://api.notion.com/v1";
const SLOTS = ["Breakfast", "Morning snack", "Lunch", "Afternoon snack", "Dinner", "Before bed"];
const MAX_ITEMS = 20;
const LOCATIONS = ["Fridge", "Freezer", "Pantry"];
// Per-serving nutrition columns in the Pantry database, keyed by the name the app uses.
const PANTRY_NUTRITION = { servings: "Servings", calories: "Calories", protein: "Protein (g)", carbs: "Carbs (g)", fat: "Fat (g)",
  fiber: "Fiber (g)", sugar: "Sugar (g)", sodium: "Sodium (mg)" };
const CATEGORIES = ["Produce", "Dairy & eggs", "Meat & fish", "Grains & bread", "Cans & jars", "Nuts & snacks", "Oils & sauces", "Frozen", "Drinks", "Other"];
const CLEANUP_PER_RUN = 40; // stays under the free plan's 50 subrequests per invocation

const dataSourceCache = new Map(); // database id -> data source id

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
    const originOk = !origin || allowed.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": originOk && origin ? origin : allowed[0] || "null",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Passcode",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const json = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method === "GET" && new URL(request.url).pathname === "/ics") return icsResponse(new URL(request.url).searchParams.get("e"));
    if (!originOk) return json({ error: "origin_not_allowed", message: `Add ${origin} to ALLOWED_ORIGINS.` }, 403);
    if (!env.NOTION_TOKEN || !env.APP_PASSCODE || !env.MEALS_DB || !env.PLAN_DB)
      return json({ error: "server_not_configured", message: "Set NOTION_TOKEN, APP_PASSCODE, MEALS_DB and PLAN_DB." }, 500);
    if (!(await sameSecret(request.headers.get("X-Passcode") || "", env.APP_PASSCODE)))
      return json({ error: "bad_passcode", message: "Wrong passcode." }, 401);

    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") return json({ ok: true });
      if (request.method === "GET" && url.pathname === "/meals") return json({ meals: await listMeals(env) });
      if (request.method === "GET" && url.pathname === "/plan") return json({ rows: await listPlan(env, url.searchParams.get("from")) });
      if (request.method === "GET" && url.pathname === "/product") return json(await readProduct(url.searchParams.get("url")));
      if (request.method === "GET" && url.pathname === "/img") return await proxyImage(url.searchParams.get("url"), cors);
      if (url.pathname === "/pantry" || url.pathname === "/pantry/batch") {
        if (!env.PANTRY_DB) return json({ error: "server_not_configured", message: "Set PANTRY_DB." }, 500);
        if (request.method === "GET" && url.pathname === "/pantry") return json({ items: await listPantry(env) });
        if (request.method === "POST" && url.pathname === "/pantry/batch") {
          let body;
          try { body = await request.json(); } catch { return json({ error: "bad_request", message: "Body must be JSON." }, 400); }
          return json(await writePantry(env, body || {}));
        }
      }
      if (request.method === "POST" && url.pathname === "/plan/batch") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "bad_request", message: "Body must be JSON." }, 400); }
        return json(await writePlan(env, body));
      }
      return json({ error: "not_found" }, 404);
    } catch (e) {
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

// ---------- auth ----------
async function sameSecret(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

// ---------- Notion ----------
async function notion(env, path, method = "GET", body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(NOTION_API + path, {
      method,
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 || (res.status >= 500 && attempt < 1)) {
      const wait = Number(res.headers.get("Retry-After")) || 1;
      await new Promise((r) => setTimeout(r, Math.min(wait, 5) * 1000 + Math.random() * 300));
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || `Notion returned ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }
  const err = new Error("Notion is rate limiting requests. Try again in a minute.");
  err.status = 429;
  throw err;
}

async function dataSourceId(env, databaseId) {
  if (dataSourceCache.has(databaseId)) return dataSourceCache.get(databaseId);
  const db = await notion(env, `/databases/${databaseId}`);
  const id = db.data_sources && db.data_sources[0] && db.data_sources[0].id;
  if (!id) { const e = new Error("That database has no data source."); e.status = 404; throw e; }
  dataSourceCache.set(databaseId, id);
  return id;
}

async function queryAll(env, dsId, query) {
  const out = [];
  let cursor;
  for (let n = 0; n < 20; n++) {
    const page = await notion(env, `/data_sources/${dsId}/query`, "POST", { page_size: 100, ...query, ...(cursor ? { start_cursor: cursor } : {}) });
    out.push(...page.results);
    if (!page.has_more) break;
    cursor = page.next_cursor;
  }
  return out;
}

const text = (p) => (p && (p.title || p.rich_text) ? (p.title || p.rich_text).map((t) => t.plain_text).join("") : "");
const num = (p) => (p && typeof p.number === "number" ? p.number : 0);
const numOrNull = (p) => (p && typeof p.number === "number" ? p.number : null);

// Micronutrient columns in the Meals database, keyed by the name the app uses.
const NUTRIENTS = {
  fiber: "Fiber (g)", iron: "Iron (mg)", zinc: "Zinc (mg)", calcium: "Calcium (mg)", magnesium: "Magnesium (mg)",
  potassium: "Potassium (mg)", vitd: "Vitamin D (mcg)", b12: "Vitamin B12 (mcg)", folate: "Folate (mcg)",
  vitc: "Vitamin C (mg)", omega3: "Omega-3 (g)",
};
const lines = (s) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

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
        nutrients: Object.fromEntries(Object.entries(NUTRIENTS).map(([k, col]) => [k, numOrNull(pr[col])])),
        groups: pr["Food groups"] && Array.isArray(pr["Food groups"].multi_select) ? pr["Food groups"].multi_select.map((o) => o.name) : [],
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
  };
  if (!/^\d{4}-\d{2}-\d{2} \d$/.test(item.key) || !item.meal || !SLOTS.includes(item.slot)) return null;
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
  if (creates.length + updates.length > MAX_ITEMS) {
    return { ok: [], failed: [{ key: "", message: `Send at most ${MAX_ITEMS} changes per request.` }] };
  }
  const jobs = [
    ...creates.map((c) => ({ kind: "create", item: cleanItem(c, false), key: c && c.key })),
    ...updates.map((u) => ({ kind: "update", item: cleanItem(u, true), key: u && u.key })),
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
        expires: pr["Expires"] && pr["Expires"].date ? String(pr["Expires"].date.start).slice(0, 10) : "",
        link: (pr["Link"] && pr["Link"].url) || "",
        image: (pr["Image"] && pr["Image"].url) || "",
        serving: text(pr["Serving size"]).trim(),
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
    expires: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.expires || "")) ? String(raw.expires) : "",
    link: webUrl(raw.link),
    image: webUrl(raw.image),
    serving: String(raw.serving || "").trim().slice(0, 60),
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
    Expires: { date: it.expires ? { start: it.expires } : null },
    Link: { url: it.link || null },
    Image: { url: it.image || null },
    "Serving size": { rich_text: it.serving ? [{ text: { content: it.serving } }] : [] },
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

// ---------- product pages and images ----------
const BROWSER = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Accept-Language": "en-US,en;q=0.9",
};
function webUrl(v) {
  try { const u = new URL(String(v || "").trim()); return /^https?:$/.test(u.protocol) && u.href.length <= 2000 ? u.href : ""; } catch { return ""; }
}
function fetchFail(message) { const e = new Error(message); e.fetchError = true; return e; }
async function fetchOut(target, accept) {
  const u = webUrl(target);
  if (!u) throw fetchFail("That isn't a web address.");
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 9000);
  try {
    const res = await fetch(u, { headers: { ...BROWSER, Accept: accept }, redirect: "follow", signal: ctl.signal });
    if (!res.ok) throw fetchFail(res.status === 403 || res.status === 429 || res.status === 503
      ? "That store blocked the request. Open the product photo, copy its image address, and paste that instead."
      : `The store returned an error (${res.status}).`);
    return res;
  } catch (e) {
    if (e.fetchError) throw e;
    throw fetchFail(e.name === "AbortError" ? "The store took too long to answer." : "Couldn't reach that address.");
  } finally { clearTimeout(t); }
}
const decode = (s) => String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#x2F;/gi, "/").trim();

// Some stores answer anything that isn't a person with a challenge page instead of the product.
function blockedPage(finalUrl, html) {
  return /\/blocked\b|captcha|challenge/i.test(finalUrl) ||
    /Robot or human\?|px-captcha|Pardon Our Interruption|verify (that )?you are (a )?human|Access Denied<\/title>/i.test(html.slice(0, 30000));
}
// The product name as written in the link, e.g. walmart.com/ip/Great-Value-Whole-Vitamin-D-Milk-1-Gallon/10450114,
// without sizes and counts so a search matches the product rather than one package size.
function nameFromLink(target) {
  let seg = [];
  try { seg = new URL(target).pathname.split("/").filter(Boolean).map((x) => { try { return decodeURIComponent(x); } catch { return x; } }); } catch { return ""; }
  const slug = seg.filter((x) => /[a-z]{2,}[-_][a-z]{2,}/i.test(x)).sort((a, b) => b.length - a.length)[0] || "";
  return slug.replace(/[-_]+/g, " ")
    .replace(/\b\d+(\.\d+)?\s*(fl|oz|ounces?|lbs?|pounds?|g|kg|ml|l|gallons?|gal|ct|count|packs?|pk|qt|quarts?|pt|pints?)\b/gi, " ")
    .replace(/\b(fl|oz)\b/gi, " ").replace(/\b\d+\b/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}
// Open Food Facts: an open grocery database with front-of-pack photos and per-serving nutrition.
// Its main search matches brand and name best; it rate-limits (about 10 searches a minute), so a few
// shorter names are tried there and, if it's unavailable, its newer search service answers instead.
const OFF_UA = { "User-Agent": "GainPlanner/1.0 (github.com/graham-goebel/Bulk)", Accept: "application/json" };
const OFF_FIELDS = "product_name,brands,image_front_url,serving_size,nutriments";
async function searchFoodFacts(name) {
  const words = name.split(" "), tries = [...new Set([name, words.slice(0, -1).join(" "), words.slice(0, 3).join(" ")])].filter((q) => q.split(" ").length >= 2 || q === name);
  for (const q of tries) {
    let data = null;
    try {
      const res = await fetch("https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&json=1&page_size=6&tagtype_0=countries&tag_contains_0=contains&tag_0=united-states&fields=" +
        OFF_FIELDS + "&search_terms=" + encodeURIComponent(q), { headers: OFF_UA, signal: AbortSignal.timeout(8000) });
      if (res.ok && /json/.test(res.headers.get("content-type") || "")) data = await res.json();
    } catch {}
    if (!data) break; // unavailable or rate-limited: use the other search
    const found = (data.products || []).filter((p) => p.image_front_url);
    if (found.length) return found;
  }
  try {
    const res = await fetch("https://search.openfoodfacts.org/search?page_size=6&fields=" + OFF_FIELDS + "&q=" +
      encodeURIComponent(`${name} countries_tags:"en:united-states"`), { headers: OFF_UA, signal: AbortSignal.timeout(8000) });
    if (res.ok) { const data = await res.json(); return (data.hits || []).filter((p) => p.image_front_url); }
  } catch {}
  return [];
}
async function productFromFoodFacts(target, why) {
  const name = nameFromLink(target), host = (() => { try { return new URL(target).hostname.replace(/^www\./, ""); } catch { return "That store"; } })();
  if (!name) throw fetchFail(`${host} blocks lookups from apps. Open the product photo, copy its image address, and paste that instead.`);
  const found = await searchFoodFacts(name);
  if (!found.length) throw fetchFail(`${host} blocks lookups from apps, and Open Food Facts has no match for “${name}”. Paste the photo's image address instead.`);
  const p = found[0], n = p.nutriments || {}, nutrition = {};
  const put = (k, v, unit) => { if (typeof v === "number" && isFinite(v)) nutrition[k] = `${+v.toFixed(2)}${unit}`; };
  put("calories", n["energy-kcal_serving"], ""); put("proteinContent", n.proteins_serving, " g"); put("carbohydrateContent", n.carbohydrates_serving, " g");
  put("fatContent", n.fat_serving, " g"); put("fiberContent", n.fiber_serving, " g"); put("sugarContent", n.sugars_serving, " g"); put("sodiumContent", n.sodium_serving, " g");
  const hasNut = Object.keys(nutrition).length > 0;
  if (hasNut && p.serving_size) nutrition.servingSize = String(p.serving_size).slice(0, 60);
  const title = name.replace(/\b\w/g, (c) => c.toUpperCase());
  return { title, image: p.image_front_url, images: found.map((x) => x.image_front_url).slice(0, 6), nutrition: hasNut ? nutrition : null, nutritionText: "",
    note: `${host} ${why}, so these photos are from Open Food Facts. Pick the one that matches.` };
}

async function readProduct(target) {
  let res;
  try { res = await fetchOut(target, "text/html,application/xhtml+xml,image/*;q=0.9,*/*;q=0.8"); }
  catch (e) { if (e.fetchError && /blocked/.test(e.message)) return productFromFoodFacts(target, "blocked the lookup"); throw e; }
  const base = res.url || target, ct = res.headers.get("content-type") || "";
  if (ct.startsWith("image/")) return { title: "", image: base, images: [base] };
  const html = (await res.text()).slice(0, 2_000_000);
  if (blockedPage(base, html)) return productFromFoodFacts(target, "shows apps a “Robot or human?” check");
  const images = [], add = (v) => { try { const u = new URL(decode(v), base).href; if (/^https?:/.test(u) && !images.includes(u)) images.push(u); } catch {} };
  let title = "", nutrition = null;
  // JSON-LD Product data is the most reliable source on store pages.
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data; try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const walk = (o) => {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) return o.forEach(walk);
      const type = [].concat(o["@type"] || []).join(" ");
      if (/Product/i.test(type)) {
        if (!title && o.name) title = decode(o.name);
        [].concat(o.image || []).forEach((im) => add(typeof im === "string" ? im : im && (im.url || im.contentUrl)));
      }
      if (!nutrition && (o.nutrition || /NutritionInformation/i.test(type))) {
        const n = o.nutrition || o, keep = {};
        ["servingSize", "calories", "proteinContent", "carbohydrateContent", "fatContent", "fiberContent", "sugarContent", "sodiumContent"]
          .forEach((k) => { if (n[k] !== undefined && n[k] !== null) keep[k] = String(n[k]).slice(0, 60); });
        if (Object.keys(keep).length) nutrition = keep;
      }
      if (o["@graph"]) walk(o["@graph"]);
    };
    walk(data);
  }
  const metas = {};
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const tag = m[0], key = (tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const val = (tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i) || [])[1];
    if (key && val && !metas[key.toLowerCase()]) metas[key.toLowerCase()] = val;
  }
  ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src", "image"].forEach((k) => metas[k] && add(metas[k]));
  const link = html.match(/<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i); if (link) add(link[1]);
  // gallery shots of the back of the pack or the Nutrition Facts panel, for reading the label
  for (const m of html.matchAll(/<img\s[^>]*>/gi)) {
    const tag = m[0], src = (tag.match(/\b(?:data-src|src)\s*=\s*["']([^"']+)["']/i) || [])[1], alt = (tag.match(/\balt\s*=\s*["']([^"']*)["']/i) || [])[1] || "";
    if (src && !/^data:/.test(src) && /nutrition|facts|label|panel|back|ingredient/i.test(src + " " + alt)) add(src);
  }
  if (!title) title = decode(metas["og:title"] || metas["twitter:title"] || (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || "");
  const site = decode(metas["og:site_name"] || "");
  if (site && title.toLowerCase().endsWith(site.toLowerCase())) title = title.slice(0, -site.length).replace(/\s*[|\-–:]\s*$/, "");
  title = title.replace(/\s*[|\-–:]\s*(Target|Walmart\.com|Walmart|Amazon\.com|Whole Foods Market|Trader Joe's|Kroger|Instacart|Costco)\s*$/i, "").slice(0, 100);
  // A text excerpt around a "Nutrition Facts" panel, if the page has one in its HTML.
  const plain = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
  const flat = decode(plain).replace(/\s+/g, " ");
  const at = flat.search(/nutrition(al)? (facts|information|info)|serving size/i);
  const nutritionText = at >= 0 ? flat.slice(Math.max(0, at - 100), at + 2500) : "";
  if (!images.length && !nutrition && !nutritionText) return productFromFoodFacts(target, "has no photo the app can read on that page").catch(() => {
    throw fetchFail("Couldn't find a product photo on that page. Paste the image address instead."); });
  return { title, image: images[0] || "", images: images.slice(0, 8), nutrition, nutritionText };
}

async function proxyImage(target, cors) {
  const res = await fetchOut(target, "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8");
  const ct = res.headers.get("content-type") || "";
  if (!ct.startsWith("image/") || /svg/.test(ct)) throw fetchFail("That address isn't a photo.");
  const len = +res.headers.get("content-length") || 0;
  if (len > 8_000_000) throw fetchFail("That photo is too large.");
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 8_000_000) throw fetchFail("That photo is too large.");
  return new Response(buf, { headers: { ...cors, "Content-Type": ct, "Cache-Control": "private, max-age=604800" } });
}

// ---------- calendar reminders ----------
// e = base64url JSON: [{ u: uid, t: title, d: "YYYYMMDDTHHMM" (local wall time), m: minutes long, n: notes, a: alert minutes before }]
function icsResponse(e) {
  let events;
  try {
    const b64 = String(e || "").replace(/-/g, "+").replace(/_/g, "/");
    events = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
  } catch { return new Response("Bad reminder link.", { status: 400 }); }
  if (!Array.isArray(events) || !events.length || events.length > 12) return new Response("Bad reminder link.", { status: 400 });
  const esc = (v) => String(v || "").slice(0, 200).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  const fold = (line) => { const out = []; let rest = line; while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = " " + rest.slice(74); } out.push(rest); return out.join("\r\n"); };
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Gain planner//Meal reminders//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const ev of events) {
    if (!ev || !/^\d{8}T\d{4}$/.test(ev.d)) return new Response("Bad reminder link.", { status: 400 });
    const y = +ev.d.slice(0, 4), mo = +ev.d.slice(4, 6) - 1, da = +ev.d.slice(6, 8), h = +ev.d.slice(9, 11), mi = +ev.d.slice(11, 13);
    const dur = Math.max(5, Math.min(240, Math.round(+ev.m || 30))), end = new Date(Date.UTC(y, mo, da, h, mi + dur));
    const p2 = (n) => String(n).padStart(2, "0");
    // floating times (no zone), so the phone reads them as its own local time
    const endStr = `${end.getUTCFullYear()}${p2(end.getUTCMonth() + 1)}${p2(end.getUTCDate())}T${p2(end.getUTCHours())}${p2(end.getUTCMinutes())}00`;
    const alert = Math.max(0, Math.min(720, Math.round(+ev.a || 0)));
    lines.push("BEGIN:VEVENT", `UID:${String(ev.u || ev.d).replace(/[^\w.-]/g, "").slice(0, 60)}@gain-planner`, `DTSTAMP:${stamp}`,
      `DTSTART:${ev.d}00`, `DTEND:${endStr}`, fold(`SUMMARY:${esc(ev.t)}`), fold(`DESCRIPTION:${esc(ev.n)}`),
      "BEGIN:VALARM", "ACTION:DISPLAY", fold(`DESCRIPTION:${esc(ev.t)}`), `TRIGGER:${alert ? `-PT${alert}M` : "PT0M"}`, "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.join("\r\n") + "\r\n", { headers: {
    "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="meal-reminder.ics"', "Cache-Control": "no-store" } });
}
