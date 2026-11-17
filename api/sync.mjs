#!/usr/bin/env node
// The archive's API generator.
//
// Pulls from every vetted source, normalises everything onto live perk ids,
// derives effects / tags / diminishing returns from the current game values,
// and writes the static JSON API that the site (and anything else) reads:
//
//   site/api/v1/meta.json        game version, source health, counts
//   site/api/v1/perks.json       every perk with live text, values and effects
//   site/api/v1/characters.json  killers and survivors
//   site/api/v1/builds.json      every build, tagged, with its DR analysis
//   site/api/v1/tags.json        tag catalogue with counts
//   site/api/v1/videos.json      latest build videos from vetted creators
//   site/api/v1/changelog.json   perk changes detected between syncs
//   site/api/v1/rules.json       the stacking rules the maths is based on
//
// Usage: node api/sync.mjs [--offline] [--no-icons]

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as tricky from './sources/tricky.mjs';
import * as wiki from './sources/wiki.mjs';
import * as otz from './sources/otzdarva.mjs';
import * as youtube from './sources/youtube.mjs';
import { fetchBuffer, pool } from './lib/http.mjs';
import { renderDescription, normName, slugify } from '../site/js/engine/text.mjs';
import { extractEffects } from '../site/js/engine/effects.mjs';
import { deriveTags, canonicalTag, TAGS, tagLabel, tagGroup } from '../site/js/engine/tags.mjs';
import { analyseBuild } from '../site/js/engine/stacking.mjs';
import { makePerkIndex, detectVideoBuilds, titleCategories } from '../site/js/engine/detect.mjs';
import { checkWriteup, fillValues, perkNameIndex } from '../site/js/engine/factcheck.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(SITE, 'api', 'v1');
const DATA = path.join(ROOT, 'data');
const args = new Set(process.argv.slice(2));
const OFFLINE = args.has('--offline');
const NO_ICONS = args.has('--no-icons');
const NOW = new Date();

const log = (...a) => console.log('[sync]', ...a);
const warn = (...a) => console.warn('[sync] WARN', ...a);

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}
async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}
/** Write only when the content differs, so unchanged syncs produce no commit. */
async function writeIfChanged(file, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let prev = null;
  try { prev = await fs.readFile(file, 'utf8'); } catch { /* new file */ }
  if (prev === text) return false;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
  return true;
}

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

// ---------------------------------------------------------------------------
const sources = [];
function sourceStatus(info, status, detail, items) {
  sources.push({ id: info.id, name: info.name, url: info.url, provides: info.provides, status, detail: detail || null, items: items ?? null });
}

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  const prevPerks = await readJson(path.join(OUT, 'perks.json'));
  const prevChars = await readJson(path.join(OUT, 'characters.json'));
  const prevMeta = await readJson(path.join(OUT, 'meta.json'));
  const prevBuilds = await readJson(path.join(OUT, 'builds.json'));
  const prevVideos = await readJson(path.join(OUT, 'videos.json'));

  // 1. Game data -------------------------------------------------------------
  let game = null;
  if (!OFFLINE) {
    try {
      game = await tricky.load();
      sourceStatus(tricky.info, 'ok', `game version ${game.version}`, Object.keys(game.perks).length);
    } catch (err) {
      warn('game data unavailable:', err.message);
      sourceStatus(tricky.info, 'error', err.message);
    }
  }
  if (!game) {
    if (!prevPerks || !prevChars) throw new Error('No game data available and no previous sync to fall back on.');
    log('using game data from the previous sync');
    game = {
      version: prevMeta?.gameVersion || null,
      updated: prevMeta?.gameDataUpdated || null,
      perks: Object.fromEntries(prevPerks.perks.map((p) => [p.id, { ...p, imageFile: null }])),
      characters: Object.fromEntries(prevChars.characters.map((c) => [c.key, c])),
      reused: true,
    };
    if (OFFLINE) sourceStatus(tricky.info, 'cached', 'offline run');
  }
  const perks = game.perks;

  // 2. Other names for perks (wiki renames), cached ----------------------------
  const aliasFile = path.join(DATA, 'cache', 'aliases.json');
  const aliasCache = (await readJson(aliasFile, {})) || {};
  const byName = new Map();
  for (const p of Object.values(perks)) byName.set(normName(p.name), p.id);
  for (const [alias, id] of Object.entries(aliasCache)) if (id && perks[id] && !byName.has(alias)) byName.set(alias, id);

  async function resolvePerk(rawName) {
    const key = normName(rawName);
    if (!key) return null;
    if (byName.has(key)) return byName.get(key);
    if (key in aliasCache && (aliasCache[key] === null || perks[aliasCache[key]])) return aliasCache[key];
    let found = null;
    if (!OFFLINE) {
      for (const alt of await wiki.perkNames(rawName)) {
        const k = normName(alt);
        if (byName.has(k)) { found = byName.get(k); break; }
      }
    }
    if (!found && key.length >= 7) {
      // spelling variants ("Chilli" / "Chili", "Favour" / "Favor")
      let best = null;
      for (const [k, id] of byName) {
        const d = editDistance(key, k);
        if (d <= 2 && (!best || d < best.d)) best = { d, id };
      }
      if (best) found = best.id;
    }
    aliasCache[key] = found;
    if (found) {
      byName.set(key, found);
      const p = perks[found];
      p.altNames = p.altNames || [];
      if (!p.altNames.some((n) => normName(n) === key) && normName(p.name) !== key) p.altNames.push(rawName);
    }
    return found;
  }

  // 3. Builds from every source ------------------------------------------------
  const rawBuilds = [];
  let otzData = null;
  if (!OFFLINE) {
    try {
      otzData = await otz.load();
      rawBuilds.push(...otzData.builds);
      sourceStatus(otz.info, 'ok', otzData.patch ? `dataset for patch ${otzData.patch.replace(/'/g, '')}` : null, otzData.builds.length);
    } catch (err) {
      warn('Otzdarva builds unavailable:', err.message);
      sourceStatus(otz.info, 'error', err.message);
    }
  }
  const curated = (await readJson(path.join(DATA, 'curated', 'builds.json'), { builds: [] })).builds || [];
  for (const b of curated) rawBuilds.push({ ...b, sourceInfo: b.source || null, source: 'curated' });
  const curatedInfo = { id: 'curated', name: 'Curated & creator builds', url: null, provides: 'Hand-checked toxic, meta and fun builds, each linked to its original source' };
  sourceStatus(curatedInfo, 'ok', null, curated.length);

  // creator channels: their latest uploads (with descriptions) from the public feeds
  const channels = (await readJson(path.join(DATA, 'curated', 'channels.json'), { channels: [] })).channels || [];
  const feedVideos = [];
  let okFeeds = 0;
  if (!OFFLINE && channels.length) {
    await pool(channels, 3, async (ch) => {
      try {
        const feed = await youtube.channelFeed(ch.id);
        okFeeds++;
        for (const v of feed) feedVideos.push({ ...v, channel: ch.name || v.channel, channelId: ch.id });
      } catch (err) { warn(`feed ${ch.name}:`, err.message); }
    });
  }

  // carry every alias the wiki scrape knows about (fills altNames without extra requests)
  if (otzData) for (const wp of otzData.wikiPerks) await resolvePerk(wp.name);

  // 3b. Builds written in creator video descriptions and titles ------------------------
  const autoFile = path.join(DATA, 'auto', 'builds.json');
  const autoStore = (await readJson(autoFile, { builds: [] })) || { builds: [] };
  if (feedVideos.length) {
    const index = makePerkIndex(Object.values(perks));
    const killerList = Object.values(game.characters).filter((c) => c.role === 'killer');
    const known = new Set(autoStore.builds.map((b) => `${b.video.id}|${[...b.perks].sort().join('|')}`));
    let added = 0;
    for (const v of feedVideos) {
      for (const d of detectVideoBuilds(v, index, killerList)) {
        const names = d.perks.map((x) => x.name);
        const key = `${v.id}|${[...names].sort().join('|')}`;
        if (known.has(key)) continue;
        known.add(key);
        autoStore.builds.push({
          title: d.label ? `${d.label}` : `${v.title.replace(/\s*\|\s*dead by daylight.*$/i, '').slice(0, 90)}${d.part ? ` (${d.part})` : ''}`,
          role: d.role, killer: d.killer?.name || null, perks: names,
          categories: ['creator', ...titleCategories(v.title)], tags: [],
          source: { name: v.channel, url: `https://www.youtube.com/watch?v=${v.id}`, date: (v.published || '').slice(0, 10) || null },
          video: { id: v.id, title: v.title, channel: v.channel },
          detection: { from: d.from, videoTitle: v.title, found: NOW.toISOString().slice(0, 10) },
        });
        added++;
      }
    }
    autoStore.builds.sort((a, b) => String(b.source.date).localeCompare(String(a.source.date)));
    autoStore.builds = autoStore.builds.slice(0, 400); // bounded: the archive never grows without limit
    if (added) log(`auto-detected ${added} new builds from creator videos`);
  }
  for (const b of autoStore.builds) rawBuilds.push({ ...b, sourceInfo: b.source, source: 'auto' });

  // 4. Perk text, effects, icons ------------------------------------------------
  const wikiText = new Map();
  if (otzData) for (const wp of otzData.wikiPerks) { const id = byName.get(normName(wp.name)); if (id && wp.text) wikiText.set(id, wp.text); }

  for (const p of Object.values(perks)) {
    const html = renderDescription(p, { tier: 3, mode: 'html' });
    p.text = renderDescription(p, { tier: 3, mode: 'text' }).value;
    p.unresolved = html.unresolved;
    // When the game data lacks a value, keep the wiki's wording as a second opinion.
    p.wikiText = html.unresolved && wikiText.has(p.id) ? wikiText.get(p.id) : p.wikiText && html.unresolved ? p.wikiText : undefined;
    p.fx = extractEffects(p);
    p.wiki = wiki.perkPageUrl(p.name);
  }

  const iconManifestFile = path.join(DATA, 'cache', 'icons.json');
  const iconManifest = (await readJson(iconManifestFile, {})) || {};
  if (!OFFLINE && !NO_ICONS) {
    const otzIcon = new Map();
    if (otzData) for (const wp of otzData.wikiPerks) { const id = byName.get(normName(wp.name)); if (id && wp.iconUrl) otzIcon.set(id, wp.iconUrl.split('?')[0]); }
    const jobs = [];
    for (const p of Object.values(perks)) {
      const file = path.join(SITE, 'assets', 'perks', `${p.id}.png`);
      if (await exists(file)) continue; // icons are kept; a changed icon can be refreshed by deleting the file
      const candidates = [otzIcon.get(p.id), ...wiki.perkIconFiles(p.imageFile).map(wiki.imageUrl)].filter(Boolean);
      if (candidates.length) jobs.push({ p, candidates, file });
    }
    let ok = 0;
    await pool(jobs, 3, async ({ p, candidates, file }) => {
      for (const src of candidates) {
        const buf = await wiki.fetchPng(src);
        if (!buf) continue;
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, buf);
        iconManifest[p.id] = src;
        ok++;
        return;
      }
      warn(`no icon found for ${p.name}`);
    });
    if (jobs.length) log(`icons: ${ok}/${jobs.length} downloaded`);
    sourceStatus(wiki.info, jobs.length && !ok ? 'error' : 'ok', jobs.length ? `${ok}/${jobs.length} new icons` : 'all icons up to date', Object.keys(perks).length);
  } else sourceStatus(wiki.info, 'cached', OFFLINE ? 'offline run' : 'icons skipped');
  for (const p of Object.values(perks)) p.icon = (await exists(path.join(SITE, 'assets', 'perks', `${p.id}.png`))) ? `assets/perks/${p.id}.png` : null;

  // 5. Characters + killer portraits ---------------------------------------------
  const characters = Object.values(game.characters);
  const portraitManifestFile = path.join(DATA, 'cache', 'portraits.json');
  const portraitManifest = (await readJson(portraitManifestFile, {})) || {};
  const killers = characters.filter((c) => c.role === 'killer');
  if (!OFFLINE && !NO_ICONS && !game.reused) {
    const otzPortrait = new Map();
    for (const [name, url] of Object.entries(otzData?.portraits || {})) otzPortrait.set(normName(name), url);
    await pool(killers, 3, async (c) => {
      const file = path.join(SITE, 'assets', 'killers', `${c.id}.png`);
      if (await exists(file)) return;
      const candidates = [c.imageFile && wiki.thumbUrl(c.imageFile.replace(/^T_UI_/i, ''), 192), wiki.toThumb(otzPortrait.get(normName(c.name)), 192)].filter(Boolean);
      for (const src of candidates) {
        const buf = await wiki.fetchPng(src);
        if (!buf) continue;
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, buf);
        portraitManifest[c.id] = src;
        return;
      }
      warn(`no portrait found for ${c.name}`);
    });
  }
  for (const c of characters) c.portrait = c.role === 'killer' && (await exists(path.join(SITE, 'assets', 'killers', `${c.id}.png`))) ? `assets/killers/${c.id}.png` : null;
  const killerByName = new Map();
  for (const c of killers) { killerByName.set(normName(c.name), c); killerByName.set(normName(c.name.replace(/^The /i, '')), c); }

  // 6. Normalise builds ------------------------------------------------------------
  const rules = await readJson(path.join(DATA, 'rules.json'), { rules: [] });
  const videoCacheFile = path.join(DATA, 'cache', 'videos.json');
  const videoCache = (await readJson(videoCacheFile, {})) || {};
  const builds = [];
  const rejected = [];
  const perkIndex = perkNameIndex(Object.values(perks));
  const fcCtx = { perkById: new Map(Object.values(perks).map((p) => [p.id, p])), allPerks: Object.values(perks), constants: rules.constants, killers };
  const seen = new Set();

  const curatedKeys = new Set(rawBuilds.filter((r) => r.source === 'curated' && r.video?.id).map((r) => `${r.video.id}|${(r.perks || []).map(normName).sort().join('|')}`));
  for (const rb of rawBuilds) {
    if (rb.source === 'auto' && curatedKeys.has(`${rb.video.id}|${rb.perks.map(normName).sort().join('|')}`)) continue;
    const ids = [];
    const missing = [];
    for (const n of rb.perks || []) { const id = await resolvePerk(n); if (id) ids.push(id); else missing.push(n); }
    if (missing.length || ids.length !== 4 || new Set(ids).size !== 4) { rejected.push({ title: rb.title, source: rb.source, reason: missing.length ? `unknown perks: ${missing.join(', ')}` : 'needs 4 distinct perks' }); continue; }
    const ps = ids.map((id) => perks[id]);
    const role = rb.role === 'survivor' ? 'survivor' : 'killer';
    if (ps.some((p) => p.role !== role)) { rejected.push({ title: rb.title, source: rb.source, reason: 'perks do not match the build role' }); continue; }

    let killer = null;
    if (role === 'killer' && rb.killer) {
      const c = killerByName.get(normName(rb.killer));
      if (!c) { rejected.push({ title: rb.title, source: rb.source, reason: `unknown killer: ${rb.killer}` }); continue; }
      killer = { id: c.id, name: c.name };
    }

    const alts = {};
    if (Array.isArray(rb.alts)) {
      for (let i = 0; i < 4; i++) {
        const list = [];
        for (const n of rb.alts[i] || []) { const id = await resolvePerk(n); if (id && perks[id].role === role && !ids.includes(id) && !list.includes(id)) list.push(id); }
        if (list.length) alts[ids[i]] = list;
      }
    }

    if (Array.isArray(rb.altNames)) rb.alts = rb.altNames;
    let categories = (rb.categories || []).map(canonicalTag);
    const notes = rb.notes || rb.tips || [];
    let summary = rb.summary || '';
    let details = rb.details || '';
    let tips = rb.tips || [];
    let sourceRef;
    if (rb.source === 'otzdarva') {
      categories = ['recommended'];
      summary = notes[0] || `${rb.title} recommended by Otzdarva${killer ? ` for ${killer.name}` : ''}.`;
      details = '';
      tips = notes.slice(1);
      sourceRef = { id: 'otzdarva', name: "Otzdarva's Builds", url: rb.sourceUrl };
    } else if (rb.source === 'auto') {
      const si = rb.sourceInfo || {};
      sourceRef = { id: slugify(si.name || 'creator'), name: si.name || 'Creator', url: si.url || null, date: si.date || null };
    } else {
      const si = rb.sourceInfo || {};
      sourceRef = { id: slugify(si.name || 'curated'), name: si.name || 'Curated', url: /^https:\/\//.test(si.url || '') ? si.url : null, date: si.date || null };
    }

    // video: confirm it exists (cached; re-checked every 30 days)
    let video = null;
    const vid = rb.video?.id;
    if (rb.source === 'auto' && vid && youtube.VIDEO_ID.test(vid)) {
      video = { id: vid, title: rb.video.title || '', channel: rb.video.channel || '' };
    } else if (vid && youtube.VIDEO_ID.test(vid)) {
      const cached = videoCache[vid];
      const fresh = cached && NOW - new Date(cached.checked) < 30 * 864e5;
      let v = fresh ? cached.data : undefined;
      if (!fresh && !OFFLINE) {
        v = await youtube.verifyVideo(vid);
        if (v !== undefined) videoCache[vid] = { checked: NOW.toISOString(), data: v };
        else v = cached?.data;
      } else if (!fresh) v = cached?.data;
      if (v) video = { id: vid, title: v.title, channel: v.channel, channelUrl: v.channelUrl };
      else if (v === null) warn(`video ${vid} for "${rb.title}" no longer exists; dropped`);
    }

    const scope = killer ? killer.id : role === 'survivor' ? slugify(rb.group || 'survivor') : 'any';
    let id = `${slugify(sourceRef.id).slice(0, 24)}-${slugify(scope)}-${slugify(rb.title)}`.slice(0, 96);
    while (seen.has(id)) id += '-2';
    seen.add(id);

    // write-ups: live values in, then fact-check against the live perk text
    const tokensMissing = [];
    const fill = (t) => { const r = fillValues(t, perkIndex); tokensMissing.push(...r.missing); return r.text; };
    summary = fill(summary); details = fill(details); tips = tips.map(fill);
    const fc = checkWriteup({ role, perks: ids, alts, summary, details, tips, checked: rb.checked, requireStamp: rb.source === 'curated' }, fcCtx);
    for (const m of tokensMissing) fc.issues.push({ key: `token:${m}`, field: 'value token', rule: 'token', severity: 'error', clause: '', message: `{{${m}}} no longer exists in the game data` });
    if (tokensMissing.length) fc.status = 'flagged';
    const check = { status: fc.status, patch: game.version, reviewed: rb.checked?.date || null, issues: fc.issues.filter((i) => !i.waived).map(({ key, ...i }) => i) };

    const build = {
      id, title: rb.title, role, killer, group: rb.group || null,
      perks: ids, layout: Array.isArray(rb.layout) && rb.layout.length === 4 ? rb.layout : null,
      alts, categories, summary, details, tips,
      source: sourceRef, video, evidence: rb.evidence || null, check, detection: rb.detection || undefined,
    };
    build.dr = analyseBuild(ps, rules, { role, killer: killer ? game.characters[Object.keys(game.characters).find((k) => game.characters[k].id === killer.id)] : null });
    build.tags = deriveTags({ ...build, tags: rb.tags || [] }, ps);
    if (build.dr.status === 'active') build.tags.push('diminishing-returns');
    if (killer) build.tags.push(`killer:${slugify(killer.name.replace(/^The /i, ''))}`);
    build.tags.push(`source:${sourceRef.id}`);
    builds.push(build);
  }
  if (rejected.length) { warn(`${rejected.length} builds rejected`); for (const r of rejected.slice(0, 40)) warn('  -', r.source, '|', r.title, '|', r.reason); }

  // If a source was down this run, keep its builds from the previous sync.
  const failed = new Set(sources.filter((s) => s.status === 'error').map((s) => s.id));
  if (prevBuilds?.builds && (failed.has('otzdarva') || OFFLINE)) {
    for (const b of prevBuilds.builds) {
      if (b.source?.id === 'otzdarva' && !seen.has(b.id) && b.perks.every((id) => perks[id])) { builds.push(b); seen.add(b.id); }
    }
  }

  // 7. Changelog: what changed in the game since the last sync -----------------------
  const changelogFile = path.join(OUT, 'changelog.json');
  const changelog = (await readJson(changelogFile, { entries: [] })) || { entries: [] };
  if (prevPerks?.perks && !game.reused) {
    const before = new Map(prevPerks.perks.map((p) => [p.id, p]));
    const date = NOW.toISOString().slice(0, 10);
    const add = (e) => changelog.entries.unshift({ date, version: game.version, ...e });
    for (const p of Object.values(perks)) {
      const old = before.get(p.id);
      if (!old) { add({ type: 'added', perk: p.id, name: p.name }); continue; }
      const changes = [];
      if (old.name !== p.name) changes.push({ what: 'name', from: old.name, to: p.name });
      const keys = new Set([...Object.keys(old.tunables || {}), ...Object.keys(p.tunables || {})]);
      for (const k of keys) {
        const a = JSON.stringify(old.tunables?.[k] ?? null), b = JSON.stringify(p.tunables?.[k] ?? null);
        if (a !== b) changes.push({ what: 'value', key: k, from: old.tunables?.[k] ?? null, to: p.tunables?.[k] ?? null });
      }
      if (old.template !== p.template) changes.push({ what: 'text', from: old.text, to: p.text });
      if (changes.length) add({ type: 'changed', perk: p.id, name: p.name, changes });
    }
    for (const [id, old] of before) if (!perks[id]) add({ type: 'removed', perk: id, name: old.name });
    changelog.entries = changelog.entries.slice(0, 300);
  }
  const recent = new Map();
  for (const e of changelog.entries) {
    if (NOW - new Date(e.date) > 45 * 864e5) continue;
    if (!recent.has(e.perk)) recent.set(e.perk, { date: e.date, version: e.version, type: e.type });
  }
  for (const b of builds) {
    const hits = b.perks.filter((id) => recent.has(id)).map((id) => ({ perk: id, ...recent.get(id) }));
    b.changed = hits.length ? hits : undefined;
  }

  // 8. Latest build videos from vetted creators --------------------------------------
  let videos = prevVideos?.videos || [];
  if (okFeeds) {
    const kw = /\bbuilds?\b|\bperks?\b|\bcombo\b|\bloadout\b|\bmeta\b|\bsynergy\b/i;
    const withBuild = new Set(autoStore.builds.map((b) => b.video.id));
    const merged = new Map();
    for (const v of [...feedVideos, ...videos]) if (!merged.has(v.id)) merged.set(v.id, v);
    videos = [...merged.values()]
      .filter((v) => kw.test(v.title) || withBuild.has(v.id))
      .map((v) => {
        const t = normName(v.title);
        let killer = null;
        for (const c of killers) { const short = normName(c.name.replace(/^The /i, '')); if (short.length >= 4 && t.includes(short)) { killer = { id: c.id, name: c.name }; break; } }
        return { id: v.id, title: v.title, channel: v.channel, channelId: v.channelId, published: v.published, killer, hasBuild: withBuild.has(v.id) };
      })
      .sort((a, b) => String(b.published).localeCompare(String(a.published)))
      .slice(0, 80);
    sourceStatus(youtube.info, okFeeds === channels.length ? 'ok' : 'partial', `${okFeeds}/${channels.length} channel feeds read, ${autoStore.builds.length} builds found in descriptions`, videos.length);
  } else sourceStatus(youtube.info, channels.length ? (OFFLINE ? 'cached' : 'error') : 'ok', OFFLINE ? 'offline run' : channels.length ? 'no channel feed could be read' : 'no channels configured', videos.length);

  // 9. Write the API ---------------------------------------------------------------
  const perkList = Object.values(perks)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({
      id: p.id, name: p.name, altNames: p.altNames?.length ? p.altNames : undefined, role: p.role, character: p.character,
      categories: p.categories, template: p.template, tunables: p.tunables, text: p.text, wikiText: p.wikiText,
      teachable: p.teachable || undefined, icon: p.icon, wiki: p.wiki, fx: p.fx,
    }));
  const charList = characters
    .sort((a, b) => (a.role === b.role ? Number(a.key) - Number(b.key) : a.role.localeCompare(b.role)))
    .map((c) => ({ id: c.id, key: c.key, name: c.name, role: c.role, speed: c.speed ?? undefined, terrorRadius: c.terrorRadius ?? undefined, portrait: c.portrait || undefined }));

  // curated / creator builds first, then the per-killer recommendations
  const rank = (b) => (b.source.id === 'otzdarva' ? 1 : 0);
  builds.sort((a, b) => rank(a) - rank(b));

  const tagCounts = {};
  for (const b of builds) for (const t of b.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
  const tags = Object.entries(tagCounts)
    .map(([id, count]) => ({ id, label: id.startsWith('killer:') ? (killers.find((k) => slugify(k.name.replace(/^The /i, '')) === id.slice(7))?.name || tagLabel(id.slice(7))) : id.startsWith('source:') ? (builds.find((b) => `source:${b.source.id}` === id)?.source.name || id.slice(7)) : tagLabel(id), group: tagGroup(id), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const changed = [];
  const w = async (name, value) => { if (await writeIfChanged(path.join(OUT, name), value)) changed.push(name); };
  await w('perks.json', { gameVersion: game.version, perks: perkList });
  await w('characters.json', { characters: charList });
  await w('builds.json', { builds });
  await w('tags.json', { tags });
  await w('videos.json', { videos });
  await w('changelog.json', changelog);
  await w('rules.json', rules);
  await writeIfChanged(aliasFile, JSON.stringify(aliasCache, null, 1));
  await writeIfChanged(iconManifestFile, JSON.stringify(iconManifest, null, 1));
  await writeIfChanged(portraitManifestFile, JSON.stringify(portraitManifest, null, 1));
  await writeIfChanged(videoCacheFile, JSON.stringify(videoCache, null, 1));
  await writeIfChanged(autoFile, JSON.stringify(autoStore, null, 1));

  // meta.json: rewritten when data changed, or weekly as a heartbeat (this
  // keeps the scheduled workflow alive without a commit every day).
  const stale = !prevMeta?.checkedAt || NOW - new Date(prevMeta.checkedAt) > 6.5 * 864e5;
  const srcSig = (list) => JSON.stringify((list || []).map((s) => [s.id, s.status, s.items]));
  if (changed.length || stale || srcSig(prevMeta?.sources) !== srcSig(sources)) {
    await writeIfChanged(path.join(OUT, 'meta.json'), {
      schema: 1,
      gameVersion: game.version,
      gameDataUpdated: game.updated,
      checkedAt: NOW.toISOString(),
      dataChangedAt: changed.length ? NOW.toISOString() : prevMeta?.dataChangedAt || NOW.toISOString(),
      counts: { perks: perkList.length, builds: builds.length, killers: killers.length, videos: videos.length, tags: tags.length },
      sources,
      rejected: rejected.length,
    });
    changed.push('meta.json');
  }

  log(`game ${game.version}: ${perkList.length} perks, ${builds.length} builds (${rejected.length} rejected), ${videos.length} videos, ${tags.length} tags`);
  log(changed.length ? `updated: ${changed.join(', ')}` : 'no changes');
}

main().catch((err) => { console.error('[sync] FAILED', err); process.exit(1); });
