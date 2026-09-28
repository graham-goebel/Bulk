// Product pages and images: reads a store's product page for its title, photos and nutrition, falling back
// to Open Food Facts when the store blocks bots, and proxies images with CORS. Reusable for any food app.
//   readProduct(url) -> { title, image, images, nutrition, nutritionText, note? }
//   proxyImage(url, corsHeaders) -> Response
//   webUrl(v) -> v as an http(s) URL, or ""
// Errors a caller should show the user carry e.fetchError = true.

const BROWSER = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Accept-Language": "en-US,en;q=0.9",
};
export function webUrl(v) {
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

export async function readProduct(target) {
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

export async function proxyImage(target, cors) {
  const res = await fetchOut(target, "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8");
  const ct = res.headers.get("content-type") || "";
  if (!ct.startsWith("image/") || /svg/.test(ct)) throw fetchFail("That address isn't a photo.");
  const len = +res.headers.get("content-length") || 0;
  if (len > 8_000_000) throw fetchFail("That photo is too large.");
  const buf = await res.arrayBuffer();
  if (buf.byteLength > 8_000_000) throw fetchFail("That photo is too large.");
  return new Response(buf, { headers: { ...cors, "Content-Type": ct, "Cache-Control": "private, max-age=604800" } });
}
