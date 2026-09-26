# Gain planner

A gluten-free weight-gain meal planner that runs on GitHub Pages and stores your meals and weekly plan in Notion.

```
web/                 the app (published to GitHub Pages)
worker/              a small Cloudflare Worker that talks to Notion for the app
.github/workflows/   deploy both from GitHub, no terminal needed
```

Why the Worker exists: browsers aren't allowed to call Notion's API directly, and your Notion token has to stay secret. The Worker holds the token, checks a passcode on every request, and only answers requests coming from your site.

Everything here fits in the free tiers of GitHub, Cloudflare and Notion.

This repository is set up for `graham-goebel/Bulk`, so the site will be at **https://graham-goebel.github.io/Bulk/** and `worker/wrangler.toml` already allows the origin `https://graham-goebel.github.io`.

Every step below works from a browser, including on an iPad. A terminal route is at the end.

## 1. Give the Worker access to Notion

1. Go to notion.so/profile/integrations (or Settings, then Connections, then "Develop or manage integrations").
2. Create a new **internal** integration for your workspace. Give it read, update and insert content permissions.
3. Copy its secret. It starts with `ntn_`.
4. Open the **Gain Planner** page in Notion, open the ••• menu, choose **Connections**, and add your integration. The Meals and Meal Plan databases inside it get access too.

## 2. Get a Cloudflare API token

1. Sign up at dash.cloudflare.com (free).
2. Copy your **Account ID**: it's in the address bar after `dash.cloudflare.com/`, and on the Workers & Pages overview page.
3. Go to My Profile, then **API Tokens**, then **Create Token**, and use the **Edit Cloudflare Workers** template. Copy the token.

## 3. Add the repository secrets

In GitHub, open the repository's **Settings**, then **Secrets and variables**, then **Actions**, and add four repository secrets:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the token from step 2 |
| `CLOUDFLARE_ACCOUNT_ID` | the account ID from step 2 |
| `NOTION_TOKEN` | the `ntn_` secret from step 1 |
| `APP_PASSCODE` | a long passcode you make up for the app |

## 4. Deploy the Worker

Open the **Actions** tab, choose **Deploy Worker to Cloudflare**, and tap **Run workflow**. (It also runs on its own whenever `worker/` changes on `main`.)

When it finishes, the log shows the Worker's address, something like `https://gain-planner-api.YOUR-NAME.workers.dev`. You can also find it in the Cloudflare dashboard under Workers & Pages. Open `https://…workers.dev/health` in a browser: it should say `{"error":"bad_passcode",…}`, which means the Worker is running and checking passcodes.

## 5. Publish the app

1. Under **Settings**, then **Secrets and variables**, then **Actions**, open the **Variables** tab and add a repository variable `WORKER_URL` set to the Worker's address from step 4. (Or edit `web/config.js` directly instead.)
2. Under **Settings**, then **Pages**, set **Source** to **GitHub Actions**.
3. On the free plan, Pages needs the repository to be public. There's nothing private in the code; your data lives in Notion.
4. Open **Actions**, choose **Deploy app to GitHub Pages**, and tap **Run workflow**. It also runs on its own whenever `web/` changes on `main`. Run it again whenever you change `WORKER_URL`.

## 6. Connect on each device

1. Open https://graham-goebel.github.io/Bulk/.
2. Tap the cloud icon at the top right. It opens Goals & settings on the Settings tab. Enter the passcode there. Once connected the icon goes away, and only comes back as a warning if a sync fails (tap it for details). Sync status is always shown in Goals & settings → Settings.
3. Enter your passcode and tap **Save**. The status changes to "Notion: synced". The first sync creates the week's 42 rows in Meal Plan.

To install it like an app: on iPhone or iPad, tap Share, then **Add to Home Screen**. On Android, open the browser menu and choose **Install app** or **Add to Home screen**.

## Pantry

The **Pantry** tab shows what's in your fridge, freezer and pantry as a 3D gallery built with three.js (bundled in `web/vendor/three`, so nothing loads from a CDN). Items float in a slowly turning sphere; drag to spin it, pinch or scroll to zoom, and tap an item to change its quantity, expiry date or location. **Shelves** stacks everything on a fridge, freezer and pantry unit, and **List** is a plain list. Search and the filters on the left narrow the view.

Items live in the **Pantry** database in Notion (`PANTRY_DB` in `worker/wrangler.toml`). On the Shop tab, check off what you bought and tap **Add checked to pantry**; items you already have get their quantity increased. Without a Notion connection the pantry is kept on the device.

To use a real product photo, open an item, paste a link to the product page (or straight to the photo) into **Store link**, and tap **Get photo**. The Worker reads the page's product photo and name; the app removes a plain studio background and shows the cut-out in the 3D view and the list. Busy lifestyle photos are left as they are. Some stores block automated requests; for those, open the photo in your browser, copy its image address, and paste that instead. The Pantry database keeps the link and photo address in its **Link** and **Image** columns.

Each item also has **Nutrition per serving** (serving size, servings per container, calories, protein, carbs, fat, fiber, sugar, sodium). **Read from store page** picks these up when the page lists them as text or product data. **Read a label photo** reads a Nutrition Facts panel with on-device OCR (tesseract.js, bundled in `web/vendor/tesseract`, about 7 MB downloaded the first time you use it): pick one of the store's photos or take your own. Always check the numbers against the package before saving.

## Meal times across time zones

Each row in Meal Plan has a **Time** column with the wall-clock time the meal is planned for, such as `07:30`. The app syncs that, so a phone and a laptop set to different time zones show the same times. **When** is kept up to date for Notion's calendar view but can look shifted if your devices are in different zones. To change a meal's time from Notion, edit **Time**.

## Marking meals eaten

Only meals you mark as eaten count toward the day's progress. Tap a meal's **⋯** menu in the Plan tab and choose **Mark eaten**, or use the next-meal card or the meal's detail sheet. The same menu can lock a meal, say you skipped it, or shuffle it to another option. Marking a meal also locks it so rebalancing won't swap it. Meals whose time has passed without being marked show as striped "not marked yet" on the calorie bar. The mark is stored in the **Eaten** column of Meal Plan, so it syncs across devices and you can tick it in Notion too.

If you skip a meal, choose **I skipped it** from its **⋯** menu or in its sheet, or tap **Skipped** on the next-meal card once the meal is due. A skipped meal comes out of the day's totals, and the day's other unlocked meals rebalance to make up for it. It's stored in the **Skipped** column of Meal Plan.

## Meal reminders

Tap the bell on the next-meal card, or **Remind me** in a meal's sheet, and choose when to be alerted (at meal time, 10 or 30 minutes before). You can include the rest of the day's meals too. On the Calendar tab, the bell next to Hour/Day/Week does the same for every upcoming meal in view (the day, or the whole week). The app opens a calendar invite with the alert already set; tap **Add** (or **Add All**) and your phone's Calendar handles the reminder, even when the app is closed. The invite is built by the Worker's `/ics` endpoint, which needs no passcode because it only turns the meal name, time and calories it's given into a calendar file.

## Shake to shuffle

Turn on **Shake to shuffle** in Goals & settings → Settings, and shaking your phone on the Plan or Dashboard tab shuffles that day's unlocked meals, the same as tapping Shuffle unlocked meals. iOS asks for motion permission the first time you turn it on.

## What syncs and what stays on the device

Stored in Notion and shared across your devices:
- the meal library (add, edit or hide meals in the Meals database)
- your weekly plan: which meal is in each slot, its time, and whether it's locked

Kept on each device:
- calorie and protein goals, default meal times, and the week's start date
- shopping list checkmarks

## Nutrition and diversity score

Each meal in the Meals database has micronutrient columns (fiber, iron, zinc, calcium, magnesium, potassium, vitamin D, B12, folate, vitamin C, omega-3), a **Food groups** tag, and a **Diversity score** formula from 0 to 10: a point per food group (up to 5) plus up to 5 for how many of the 11 nutrients reach 15% of the daily value. Edit the numbers or tags in Notion and the score updates itself.

The app shows the breakdown in each meal's detail sheet, the score on the plan cards, a variety line under the day's totals, and a day-wide nutrient summary in Calendar's Day view. When it fills unlocked slots, it also prefers days that cover more food groups.

The built-in values are estimates from typical USDA ingredient data, so labels on the brands you buy may differ.

## Cleaning up old weeks

Every week adds 42 rows to Meal Plan. They're kept as history by default. To tidy them automatically, set `KEEP_WEEKS` in `worker/wrangler.toml` (for example `"8"`) and deploy the Worker again. Once a day it moves up to 40 rows older than that many weeks to Notion's trash, where they can be restored for 30 days. The app only reads rows from the current week start on, so this never touches the plan you're using.

## Status messages

| Message | What to do |
|---|---|
| Connect Notion | Enter your passcode in Goals & settings → Settings. |
| Wrong passcode | Re-enter it. It must match `APP_PASSCODE` exactly. |
| This site isn't on the server's allowed list | Fix `ALLOWED_ORIGINS` in `worker/wrangler.toml` (origin only, no path, no trailing slash) and deploy the Worker again. |
| The server is missing its settings | Add the `NOTION_TOKEN` and `APP_PASSCODE` secrets, then deploy the Worker again. |
| The server's Notion token isn't valid | Put a fresh integration secret in `NOTION_TOKEN` and deploy the Worker again. |
| Share Gain Planner with your integration | Do step 1.4. |
| Can't reach the server | Check `WORKER_URL` (or `web/config.js`) and your connection. |

## From a terminal instead

You need Node.js 18 or later.

```sh
cd worker
npm install
npx wrangler login
npx wrangler secret put NOTION_TOKEN     # the ntn_ secret from step 1
npx wrangler secret put APP_PASSCODE     # a long passcode for the app
npx wrangler deploy
curl -H "X-Passcode: YOUR-PASSCODE" https://gain-planner-api.YOUR-NAME.workers.dev/health   # {"ok":true}
```

If the GitHub secrets `NOTION_TOKEN` or `APP_PASSCODE` are left empty, the Worker workflow leaves whatever you set with `wrangler secret put` alone.

To try the app locally, serve `web/` (for example `cd web && python3 -m http.server 8000`), add `http://localhost:8000` to `ALLOWED_ORIGINS` (comma-separated) and deploy the Worker again.

## Security notes

- Anyone with the passcode can read and change your meal plan, so make it long and don't reuse it. Each device stores it in the browser once you save it.
- To change it, update `APP_PASSCODE` and deploy the Worker again, then re-enter it on each device.
- For a stronger lock, put the Worker behind Cloudflare Access so only your email can reach it.
- The Notion token never leaves Cloudflare and GitHub's encrypted secrets.
