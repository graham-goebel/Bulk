# Reusing the style and integrations

The planner is split so the look, the interaction pieces and the Notion plumbing can move to another
project without the meal-planning code. Nothing needs a build step.

```
web/ui/kit.css     design tokens (colors, light/dark) and every shared component's styles
web/ui/kit.js      toasts, menus, sheets (nested, with back and swipe), action chips, search clear
web/ui/icons.js    the icon sprite (Heroicons, MIT) as <symbol id="i-NAME">
web/ui/api.js      client for a JSON API behind a passcode (the Worker below)
web/ui/demo.html   a page using only the four files above: open it to see everything working

worker/src/lib/notion.js   Notion REST client: requests with retry, data sources, paging, property helpers
worker/src/lib/http.js     CORS allow-list, JSON responses, constant-time passcode check, body parsing
worker/src/lib/product.js  store product pages, Open Food Facts fallback, image proxy
worker/src/lib/ics.js      calendar (.ics) reminders from a link, no storage
```

## Front end

1. Copy `web/ui/` into the new project (keep the folder name, or update the paths below).
2. Start from `web/ui/demo.html`, or add this to a page:

```html
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300..600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="ui/kit.css">
<link rel="stylesheet" href="app.css">          <!-- your own styles, after the kit -->
…
<body>
<script src="ui/icons.js"></script>             <!-- first thing in <body> -->
…your markup…
<div class="toasts" id="toasts" aria-live="polite"></div>
<div class="sheet-bg" id="sheet" hidden><div class="sheet" id="sheetBox" role="dialog" aria-modal="true" aria-labelledby="shTitle"></div></div>
<script src="ui/kit.js"></script>
<script src="ui/api.js"></script>               <!-- only if you use the Worker -->
<script src="app.js"></script>
```

3. In your script, set a storage key for the action counts: `UI.actionsKey = "myapp-actions";`

### Rebranding

Change the tokens at the top of `kit.css` (or override them in your own stylesheet):
`--ink` (text and primary), `--muted`, `--line`, `--bg`, `--soft` (chip and button fills), `--card`,
plus the dark-mode set. Fonts are Geist; swap the `font-family` on `body`.

### Components (class names)

| Component | Markup |
|---|---|
| Header | `.app-head` > `.h-txt` > `.h-title`, `.head-r` for icon buttons |
| Icon button | `button.icon-btn` (`.bare` for no fill) with `<svg class="ic"><use href="#i-NAME"/></svg>` |
| Section title row | `.cal-title` > `.ct-t` > `h2`, `.ct-btns` |
| Chips / filters | `button.pan-opt[aria-pressed]`, add `.with-ic` when it has an icon |
| Search | `label.pan-search` > `svg.ic` + `input[type=search]`, then `addClear(input)` |
| List rows | `.pk-list` > `button.pk-row` > `.nm` + `.mt`; a heart: `svg.ic.fav-ic` |
| Key/value list | `ul.ing` > `li` > `span` + `span.q` |
| Form | `.pf` grid of `label` + `input`/`select` |
| Segmented | `.seg` > `button[aria-pressed]` |
| Tags | `.tag` (`.warn`) |
| Tab bar | `nav.tabbar` > `button[aria-current=page]` |
| Buttons | `.btn`, `.txt` (text link), `.sh-act` (a sheet bar's primary action) |

### Sheets

```js
function closeSheet(){ hideBg($("sheet")); sheetScroll = {}; document.body.style.overflow = ""; }

function openList(){                                   // level 1
  if ($("sheet").hidden) $("sheetBox").style.height = ""; else holdSize();
  $("sheetBox").innerHTML = sheetHead("Eyebrow", "Title") + `<div class="pk-list">…</div>`;
  showBg($("sheet")); resetSheet($("sheetBox"));
  $("shClose").onclick = closeSheet;
  sheetActs([["plusl", "Add", onAdd], ["heart", "Favorite", onFav]]);   // floating chips, most used first
}
function openItem(k){                                  // level 2: same sheet, back arrow
  holdSize();                                          // keeps the size, remembers level 1's scroll
  $("sheetBox").innerHTML = sheetHead("", "Item");
  showBg($("sheet")); resetSheet($("sheetBox"));
  backBtn(openList);                                   // back returns to level 1 where it was scrolled
}
swipeDismiss($("sheet"), () => { if (nestedSheet()) { $("shClose").click(); return "back"; } closeSheet(); }, nestedSheet);
```

`sheetHead(eyebrow, title, {action: {id, label}})` puts a primary button (like Save) in the bar.
Give a footer bar the class `rb-foot` to pin it to the bottom edge when content is short.

### Menus and toasts

```js
openMenu(button, "Account", [["book", "Recipe book", openBook], ["cog", "Settings", openSettings], ["x", "Hidden", fn, true]]);
toast("Saved", {kind: "ok", icon: "heartf"});
toast("Deleted it", {kind: "removed", action: "Undo", onAction: restore, ms: 6000});
toast("Syncing…");                                     // kind "info" spins until replaced (same key)
```

Icon names are the `id`s in `icons.js` without `i-`. Menus and chips swap a solid icon for its outline
version through `OUTLINE` (for example `ok` → `okl`).

## Worker (Cloudflare) and Notion

Copy `worker/src/lib/` and write your own `index.js` routes:

```js
import { dataSourceId, queryAll, patchPage, isPageId, text, num, checkbox } from "./lib/notion.js";
import { cors, jsonResponse, readJson, sameSecret } from "./lib/http.js";

export default {
  async fetch(request, env) {
    const { ok, headers } = cors(request, env.ALLOWED_ORIGINS);
    const json = jsonResponse(headers);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (!ok) return json({ error: "origin_not_allowed" }, 403);
    if (!(await sameSecret(request.headers.get("X-Passcode") || "", env.APP_PASSCODE))) return json({ error: "bad_passcode" }, 401);

    const url = new URL(request.url);
    if (url.pathname === "/items") {
      const ds = await dataSourceId(env, env.ITEMS_DB);
      const pages = await queryAll(env, ds, { sorts: [{ property: "Name", direction: "ascending" }] });
      return json({ items: pages.map((p) => ({ id: p.id, name: text(p.properties.Name), done: checkbox(p.properties.Done) })) });
    }
    if (url.pathname === "/items/done" && request.method === "POST") {
      const b = await readJson(request);
      if (!b || !isPageId(b.id)) return json({ error: "bad_request" }, 400);
      await patchPage(env, b.id, { Done: { checkbox: !!b.done } });
      return json({ ok: true });
    }
    return json({ error: "not_found" }, 404);
  },
};
```

Secrets and settings are the same as this project's (see the README): `NOTION_TOKEN` and `APP_PASSCODE`
as secrets, `ALLOWED_ORIGINS` and your database ids as vars in `wrangler.toml`, and share each Notion
database with the integration. The GitHub workflow in `.github/workflows/worker.yml` deploys it.

On the page, point `ui/api.js` at it:

```js
API.configure({ url: "https://my-api.me.workers.dev", passKey: "myapp-pass" });
const { items } = await apiRead("/items");
await api("/items/done", { id, done: true });
```

A sign-in link (`https://site/#key=PASSCODE`) stores the passcode on a device and cleans the address bar.
