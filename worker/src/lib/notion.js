// Notion REST client for Cloudflare Workers (or any runtime with fetch).
// Reusable: nothing here knows about meals. Pass `env` with NOTION_TOKEN.
//   notion(env, path, method, body)   one request, retried on 429 / a 5xx
//   dataSourceId(env, databaseId)     the database's (first) data source, cached per isolate
//   queryAll(env, dsId, query)        every page of a query (up to 2,000 rows)
//   patchPage(env, id, properties)    update a page's properties
//   Property readers: text, num, numOrNull, checkbox, select, multiSelect, url, date; writer: richText.

export const NOTION_VERSION = "2025-09-03";
const NOTION_API = "https://api.notion.com/v1";
const dataSourceCache = new Map(); // database id -> data source id

export async function notion(env, path, method = "GET", body) {
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

export async function dataSourceId(env, databaseId) {
  if (dataSourceCache.has(databaseId)) return dataSourceCache.get(databaseId);
  const db = await notion(env, `/databases/${databaseId}`);
  const id = db.data_sources && db.data_sources[0] && db.data_sources[0].id;
  if (!id) { const e = new Error("That database has no data source."); e.status = 404; throw e; }
  dataSourceCache.set(databaseId, id);
  return id;
}

export async function queryAll(env, dsId, query) {
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

export const patchPage = (env, id, properties) => notion(env, `/pages/${id}`, "PATCH", { properties });
export const isPageId = (id) => typeof id === "string" && /^[0-9a-f-]{32,36}$/i.test(id);

// ---------- reading and writing properties ----------
export const text = (p) => (p && (p.title || p.rich_text) ? (p.title || p.rich_text).map((t) => t.plain_text).join("") : "");
// Notion caps each rich-text run at 2,000 characters, so longer text goes in as several runs.
export const richText = (s) => { const out = []; for (let i = 0; i < s.length && out.length < 10; i += 2000) out.push({ text: { content: s.slice(i, i + 2000) } }); return out; };
export const num = (p) => (p && typeof p.number === "number" ? p.number : 0);
export const numOrNull = (p) => (p && typeof p.number === "number" ? p.number : null);
export const checkbox = (p) => !!(p && p.checkbox);
export const select = (p) => (p && p.select ? p.select.name : "");
export const multiSelect = (p) => (p && Array.isArray(p.multi_select) ? p.multi_select.map((o) => o.name) : []);
export const url = (p) => (p && p.url) || "";
export const date = (p) => (p && p.date ? String(p.date.start) : "");
export const lines = (s) => s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
