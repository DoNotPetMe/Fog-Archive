# Fog Archive

An Entity-themed Dead by Daylight build archive: toxic, meta, fun, creator and recommended
builds for every killer and for survivors, with perk icons laid out like the in-trial HUD,
live perk values, diminishing returns worked out per build, and a companion Opera extension
that watches creator channels for new builds.

## What keeps it correct

| Concern | How it is handled |
|---|---|
| Perk changes | Every sync re-reads the game data (perk text + per-tier values, `dbd.tricky.lol`). Changes are logged on the **Changes** page, builds using a changed perk are flagged, and their diminishing returns are recalculated. |
| Diminishing returns | `site/js/engine/stacking.mjs`, using the 9.6.0 rule (strongest first at 100 / 50 / 25 / 12.5 / 5 %). Rule constants live in `data/rules.json`, each with a quoted source. |
| Wrong write-ups | `site/js/engine/factcheck.mjs` checks every sentence against the live text of the perks actually in that build: cause → effect, manual vs automatic, basic attack only, range, line of sight, one generator vs many, "first time" only, automatic Tokens, status effects, numbers, misattributed perks. A write-up that fails is **not shown**; the card falls back to a summary generated from the perks. Reviewed write-ups are stamped with a hash of each perk; when a patch changes one, the write-up is hidden again until it is re-checked. |
| Stale numbers | Write-ups write numbers as value tokens (`{{Surge|affecteddistance}} m`), filled from live data at each sync. |

Run the checks yourself:

```bash
npm test
```

```bash
npm run check
```

## Free to run, forever

Everything is static files plus a scheduled job, so there is no server or database to pay for:

* **GitHub Pages** hosts the site and the JSON API (`site/api/v1/*.json`).
* **GitHub Actions** (`.github/workflows/sync.yml`) syncs every 6 hours, runs the tests and redeploys.
  Both are free with no time limit for public repositories.
* Storage stays small and bounded: ~1 MB of JSON, ~9 MB of icons and portraits, auto-found builds capped
  at 400, videos at 80. The job only commits when data actually changed (plus a weekly heartbeat that keeps
  the schedule alive — GitHub pauses schedules in repositories with no activity for 60 days).
* The extension stores its finds in your browser only (capped at 500 builds), never in the cloud.

### Publish it

1. Create a free GitHub account and an empty **public** repository (for example `fog-archive`).
2. From this folder:
   ```bash
   git init -b main
   ```
   ```bash
   git add -A && git commit -m "Fog Archive"
   ```
   ```bash
   git remote add origin https://github.com/YOUR-NAME/fog-archive.git && git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Source: GitHub Actions**. The workflow runs on the push and the site appears at
   `https://YOUR-NAME.github.io/fog-archive/`.

## Run locally

```bash
node server.mjs
```

Then open http://localhost:4173/. `node api/sync.mjs` refreshes the data (`--offline` reuses the last sync).
The local server also answers queries: `/api/v1/builds?q=legion&tag=toxic&role=killer&video=1`.

## The Opera extension (Fog Archive Scout)

Install: `opera://extensions` → turn on **Developer mode** → **Load unpacked** → choose the `extension` folder.

* Checks your channel list every 15 minutes to 24 hours (Options), or on demand from the popup.
* Reads each channel's public upload feed, finds builds in **titles and descriptions**, and shows them in the
  archive under **My builds** with where they were found.
* On a YouTube video, the **Find build** button reads the title and description first, then (when you click)
  asks **YouTube's "Ask" AI** — only offered to signed-in accounts — and, as a last resort, the **comments**
  (the creator's / pinned comments first; viewer comments are marked risky).
* Learns your archive's address the first time you open it. **Export** writes finds in the curated format so they
  can be added to the shared archive (`data/curated/builds.json`), where they must pass the fact check.

## Sources

| Source | Used for |
|---|---|
| dbd.tricky.lol | Perk text, per-tier values, characters, game version |
| Dead by Daylight Wiki | Icons, portraits, perk renames, stacking rules (only paths its robots.txt allows) |
| Otzdarva's Builds | Recommended builds for every killer and survivor builds |
| Creator channels (`data/curated/channels.json`) | Builds written in video titles / descriptions |
| Curated builds (`data/curated/builds.json`) | Toxic, meta and fun builds from creators, NightLight stats and guide sites, each linked to its source |

NightLight's terms forbid automated collection, so its usage numbers are only quoted (with dates) in the
curated meta builds and refreshed by hand.

Add a creator channel:

```bash
node api/tools/resolve-channel.mjs @handle
```

Fan-made and unofficial. Dead by Daylight and all related names, perks and artwork belong to Behaviour
Interactive and their licensors.
