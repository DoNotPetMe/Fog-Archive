// Fog Archive Scout — background worker.
//
// Every N minutes (configurable, or on demand) it reads the public upload feeds
// of your chosen Dead by Daylight channels, finds builds written in video titles
// and descriptions, and keeps them in this browser (chrome.storage.local, capped
// so it never grows without limit). Nothing is uploaded anywhere: the archive
// page reads these finds through its content script.
//
// Where a build was found decides how far it is trusted:
//   title / description (written by the creator)  high
//   YouTube's "Ask" AI answer                    medium
//   a comment by the creator / pinned comment    medium
//   other viewers' comments                      low ("risky")

import { makePerkIndex, detectVideoBuilds, extractBuilds, titleCategories, looksLikeBuildVideo } from './lib/detect.mjs';
import { normName } from './lib/text.mjs';

const DEFAULT_CHANNELS = [
  ['UC7U8EmWt_LYbSfpUjPQaWKA', 'Tatariu'], ['UCMpvShSjgBw3FVYYlBBIweA', 'More Seine'], ['UCb243glXKZ3dbqoEvxc-hYQ', 'Seine'],
  ['UCDO__Z-tZD4bfG9m4AkK_uA', 'not Otzdarva'], ['UCUhGCdMIFqcRlHb_dthD5Xw', 'Otzdarva'], ['UCR5hk1KJMfT-tzrA7Vu5WgQ', 'Monto'],
  ['UCsbbUua4-XSHMoCUbP1h0Fg', 'blackoutraven'], ['UCYU5Y60D8p4E2ifVIEFPdmA', 'Final Chase'], ['UCbaAPYR45VYpl3T9DOiGBSA', 'Kam'],
  ['UCyXoJXyGvrkechywZx5tXTg', 'Fuhb'], ['UCtemvJ-ngKgSwjQLpz_GKcw', 'chazz'], ['UCdvT7UvQEjBN8kMGwn7jMww', 'Melo'], ['UCr8skIrWZGMXNRDQpEWljkA', 'Lil Belly'],
].map(([id, name]) => ({ id, name }));

export const DEFAULTS = {
  siteUrl: '', // learned the first time you open the archive; can be set in Options
  intervalMinutes: 180,
  notify: true,
  sources: { title: true, description: true, askAI: true, comments: true },
  keywords: ['build', 'perk', 'combo', 'loadout', 'meta', 'synergy'],
  channels: DEFAULT_CHANNELS,
};
const LIMITS = { videos: 300, builds: 500, seen: 4000 };
const CONFIDENCE = { description: 'high', title: 'high', 'youtube-ai': 'medium', 'creator-comment': 'medium', comment: 'low' };
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

// ------------------------------------------------------------------ helpers
async function settings() {
  const { settings: s } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(s || {}), sources: { ...DEFAULTS.sources, ...(s?.sources || {}) } };
}

async function fetchWithTimeout(url, ms = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit', cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
  } finally { clearTimeout(t); }
}
const fetchText = async (url) => (await fetchWithTimeout(url)).text();
const fetchJson = async (url) => (await fetchWithTimeout(url)).json();

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

const decode = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');

/** Parse a YouTube channel feed (Atom). DOMParser is not available in a service worker. */
function parseFeed(xml) {
  const channel = decode((/<title>([^<]*)<\/title>/.exec(xml) || [])[1] || '');
  return xml.split('<entry>').slice(1).map((e) => ({
    id: (/<yt:videoId>([^<]+)</.exec(e) || [])[1],
    title: decode((/<title>([^<]*)<\/title>/.exec(e) || [])[1] || ''),
    published: (/<published>([^<]+)</.exec(e) || [])[1] || null,
    description: decode((/<media:description>([\s\S]*?)<\/media:description>/.exec(e) || [])[1] || ''),
    channel,
  })).filter((v) => VIDEO_ID.test(v.id || ''));
}

// ------------------------------------------------------- perks from the archive
async function perkData() {
  const s = await settings();
  const { perkCache } = await chrome.storage.local.get('perkCache');
  const usable = perkCache && perkCache.site === s.siteUrl && Date.now() - perkCache.fetched < 12 * 3600e3;
  if (!usable && s.siteUrl) {
    try {
      const [p, c] = await Promise.all([fetchJson(new URL('api/v1/perks.json', s.siteUrl)), fetchJson(new URL('api/v1/characters.json', s.siteUrl))]);
      const cache = {
        site: s.siteUrl, fetched: Date.now(), version: p.gameVersion,
        perks: p.perks.map((x) => ({ id: x.id, name: x.name, altNames: x.altNames || [], role: x.role })),
        killers: c.characters.filter((k) => k.role === 'killer').map((k) => ({ id: k.id, name: k.name })),
      };
      await chrome.storage.local.set({ perkCache: cache });
      return withIndex(cache);
    } catch (err) {
      if (!perkCache) throw new Error(`Could not read perks from ${s.siteUrl} (${err.message})`);
    }
  }
  if (!perkCache) throw new Error('Open your Fog Archive once so the extension learns where it is (or set its address in Options).');
  return withIndex(perkCache);
}
function withIndex(cache) {
  return { ...cache, index: makePerkIndex(cache.perks), byId: new Map(cache.perks.map((p) => [p.id, p])) };
}

/** Perks named anywhere in free text (AI answers, comments): longest match first, exact names only. */
function perksInText(text, index) {
  const words = String(text || '').replace(/[“”"()[\]]/g, ' ').split(/[\s,;/|+]+|(?<=[a-z])\.(?=\s|$)/i).filter(Boolean);
  const found = [];
  for (let i = 0; i < words.length; i++) {
    for (let n = Math.min(6, words.length - i); n >= 1; n--) {
      const k = normName(words.slice(i, i + n).join(' '));
      const p = k.length >= 4 ? index.exact.get(k) : null;
      if (p) { if (!found.includes(p)) found.push(p); i += n - 1; break; }
    }
  }
  return found;
}

function buildId(videoId, perkIds) {
  let h = 0;
  for (const ch of `${videoId}|${[...perkIds].sort().join('|')}`) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  return `x${h.toString(36)}`;
}

function toBuild(f, video, from) {
  const perkIds = f.perks.map((p) => p.id);
  return {
    id: buildId(video.id, perkIds),
    title: (f.label || `${video.title.replace(/\s*\|\s*dead by daylight.*$/i, '')}${f.part ? ` (${f.part})` : ''}`).slice(0, 100),
    perks: perkIds,
    perkNames: f.perks.map((p) => p.name),
    killer: f.killer?.id || '',
    video: video.id, videoTitle: video.title, channel: video.channel || '',
    foundIn: from, confidence: CONFIDENCE[from] || 'low',
    tags: ['creator', ...titleCategories(video.title)],
    found: new Date().toISOString().slice(0, 10),
    published: video.published || null,
    support: f.support || undefined,
  };
}

async function saveFinds(newBuilds, newVideos = []) {
  const data = await chrome.storage.local.get(['builds', 'videos']);
  const builds = data.builds || [];
  const videos = data.videos || [];
  const have = new Set(builds.map((b) => b.id));
  const added = newBuilds.filter((b) => !have.has(b.id));
  const vHave = new Set(videos.map((v) => v.id));
  for (const v of newVideos) if (!vHave.has(v.id)) videos.push(v);
  videos.sort((a, b) => String(b.published).localeCompare(String(a.published)));
  const all = [...added, ...builds].slice(0, LIMITS.builds);
  await chrome.storage.local.set({ builds: all, videos: videos.slice(0, LIMITS.videos) });
  return added;
}

async function setBadge() {
  const { unseen = 0 } = await chrome.storage.local.get('unseen');
  await chrome.action.setBadgeBackgroundColor({ color: '#b3131b' });
  await chrome.action.setBadgeText({ text: unseen ? String(Math.min(unseen, 99)) : '' });
}

// --------------------------------------------------------------- the check
let running = null;
export function runCheck(reason) {
  if (running) return running;
  running = (async () => {
    const s = await settings();
    const state = { lastCheck: new Date().toISOString(), reason, error: null, newBuilds: 0, channelsRead: 0, failed: [] };
    try {
      const { index, killers } = await perkData();
      const { seen: seenList = [] } = await chrome.storage.local.get('seen');
      const firstRun = seenList.length === 0;
      const seen = new Set(seenList);
      const channels = s.channels.filter((c) => CHANNEL_ID.test(c.id));
      const feeds = await pool(channels, 3, async (ch) => {
        try { return { ch, items: parseFeed(await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${ch.id}`)) }; } catch (err) { return { ch, error: err.message }; }
      });
      const builds = [];
      const videos = [];
      for (const f of feeds) {
        if (f.error) { state.failed.push(`${f.ch.name}: ${f.error}`); continue; }
        state.channelsRead++;
        for (const v of f.items) {
          if (seen.has(v.id)) continue;
          seen.add(v.id);
          v.channel = f.ch.name || v.channel;
          const found = detectVideoBuilds({ title: s.sources.title ? v.title : '', description: s.sources.description ? v.description : '' }, index, killers);
          if (found.length || looksLikeBuildVideo(v.title, s.keywords)) {
            videos.push({ id: v.id, title: v.title, channel: v.channel, channelId: f.ch.id, published: v.published, hasBuild: found.length > 0 });
          }
          for (const d of found) builds.push(toBuild(d, v, d.from));
        }
      }
      const added = await saveFinds(builds, videos);
      await chrome.storage.local.set({ seen: [...seen].slice(-LIMITS.seen) });
      state.newBuilds = added.length;
      if (added.length && !firstRun) {
        const { unseen = 0 } = await chrome.storage.local.get('unseen');
        await chrome.storage.local.set({ unseen: unseen + added.length });
        if (s.notify) {
          chrome.notifications.create(`fog-${Date.now()}`, {
            type: 'basic', iconUrl: 'icons/icon128.png',
            title: added.length === 1 ? 'New build found' : `${added.length} new builds found`,
            message: added.slice(0, 3).map((b) => `${b.channel}: ${b.title}`).join('\n'),
          });
        }
      }
    } catch (err) {
      state.error = err.message;
    }
    await chrome.storage.local.set({ state });
    await setBadge();
    return state;
  })().finally(() => { running = null; });
  return running;
}

async function schedule() {
  const s = await settings();
  const period = Math.max(15, Math.min(1440, Number(s.intervalMinutes) || 180));
  await chrome.alarms.clear('check');
  await chrome.alarms.create('check', { periodInMinutes: period, delayInMinutes: 1 });
}

chrome.runtime.onInstalled.addListener(async () => {
  const { settings: cur } = await chrome.storage.local.get('settings');
  if (!cur) await chrome.storage.local.set({ settings: DEFAULTS });
  await schedule();
});
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'check') runCheck('scheduled'); });
chrome.notifications?.onClicked.addListener(async () => {
  const s = await settings();
  if (s.siteUrl) chrome.tabs.create({ url: `${s.siteUrl}#/builds?tags=mine` });
});

// ---------------------------------------------------------- single videos
/** Title + full description of one video, read from its public watch page. */
async function scanVideo(id) {
  if (!VIDEO_ID.test(id)) throw new Error('not a video id');
  const s = await settings();
  const { index, killers } = await perkData();
  let html = await fetchText(`https://www.youtube.com/watch?v=${id}&hl=en`);
  if (!/"shortDescription":"/.test(html)) {
    // a cookie-consent page instead of the video: retry with the browser's own YouTube cookies
    const res = await fetch(`https://www.youtube.com/watch?v=${id}&hl=en`, { credentials: 'include', cache: 'no-store' });
    if (res.ok) html = await res.text();
  }
  const raw = /"shortDescription":"((?:[^"\\]|\\.)*)"/.exec(html)?.[1];
  let description = '';
  try { description = raw ? JSON.parse(`"${raw}"`) : ''; } catch { description = ''; }
  let title = decode(/<meta name="title" content="([^"]*)"/.exec(html)?.[1] || '');
  const channel = decode(/"ownerChannelName":"((?:[^"\\]|\\.)*)"/.exec(html)?.[1] || '');
  const published = /"publishDate":"([^"]+)"/.exec(html)?.[1] || null;
  if (!title) title = decode(/<title>([^<]*)<\/title>/.exec(html)?.[1] || '').replace(/\s*-\s*YouTube$/, '');
  const video = { id, title, channel, published };
  const found = detectVideoBuilds({ title: s.sources.title ? title : '', description: s.sources.description ? description : '' }, index, killers).map((d) => toBuild(d, video, d.from));
  return { video, found, hasDescription: !!description };
}

/** Builds in a piece of text from the watch page (an AI answer or comments). */
async function detectText({ texts, from, video }) {
  const { index, killers } = await perkData();
  const out = new Map();
  for (const t of (texts || []).slice(0, 400)) {
    const candidates = [...extractBuilds(t.text, index, killers, video.title)];
    {
      // also line by line: one build per line ("Chase: a, b, c, d"), or several unnamed builds in a row of 8 / 12 / 16 perks
      for (const line of String(t.text).split(/\r?\n/)) {
        const m = /^\s*(?:[-•*\d.)]+\s*)?([^:,]{2,40}):\s*(.+)$/.exec(line);
        const label = m && !/^(hex|boon|scourge hook|teamwork|invocation)$/i.test(m[1].trim()) ? m[1].trim() : '';
        const ps = perksInText(label ? m[2] : line, index);
        if (ps.length >= 4 && ps.length % 4 === 0 && ps.every((p) => p.role === ps[0].role)) {
          for (let i = 0; i < ps.length; i += 4) candidates.push({ label: ps.length === 4 ? label : '', part: ps.length > 4 ? `Build ${i / 4 + 1}` : '', perks: ps.slice(i, i + 4), role: ps[0].role, killer: null });
        }
      }
    }
    for (const c of candidates) {
      const src = from === 'comment' && t.creator ? 'creator-comment' : from;
      const b = toBuild(c, video, src);
      const prev = out.get(b.id);
      if (prev) { prev.support = (prev.support || 1) + 1; if (CONFIDENCE[src] === 'medium') { prev.foundIn = src; prev.confidence = 'medium'; } } else out.set(b.id, { ...b, support: 1 });
    }
  }
  // a single viewer comment is the riskiest source there is: say so
  return [...out.values()].map((b) => (b.foundIn === 'comment' ? { ...b, risk: b.support > 1 ? `${b.support} viewer comments agree` : 'only one viewer comment says this' } : b));
}

/**
 * Buzzword check for "is this a Dead by Daylight video?" so the panel shows on any DBD video,
 * whichever channel posted it. Clear signals win outright; weaker ones need to add up.
 */
async function isDbd({ title = '', channel = '', description = '' }) {
  const text = `${title}\n${channel}\n${description}`.slice(0, 5000);
  if (/dead\s*by\s*daylight|#dbd\b|\bdbd\b|\bbhvr\b|behaviour interactive/i.test(text)) return { dbd: true, why: 'keyword' };
  const s = await settings();
  if (channel && s.channels.some((c) => c.name && normName(c.name) === normName(channel))) return { dbd: true, why: 'your channel' };
  const { perkCache } = await chrome.storage.local.get('perkCache');
  if (!perkCache) return { dbd: false };
  const low = ` ${text.toLowerCase().replace(/[^a-z0-9:&' ]+/g, ' ').replace(/\s+/g, ' ')} `;
  let score = 0;
  for (const p of perkCache.perks) {
    const n = p.name.toLowerCase();
    const short = n.replace(/^(hex|boon|scourge hook|teamwork|invocation):\s*/, '');
    if ([n, short].some((x) => x.includes(' ') && x.length >= 8 && low.includes(` ${x} `))) score += 2; // a two-word perk name
  }
  for (const k of perkCache.killers) if (low.includes(` ${k.name.toLowerCase()} `)) score += 1; // "The Legion" (also an English phrase)
  // distinct DBD words ("killer", "perk", "gens"...), up to 2 points
  score += Math.min(2, new Set(low.match(/\b(?:survivors?|killers?|perks?|hooks?|gens?|generators?|totems?|the entity|tunnel(?:ing)?|slug(?:ging)?|camp(?:ing)?|loop(?:ing)?)\b/g) || []).size);
  return { dbd: score >= 3, why: `score ${score}` };
}

async function resolveChannel(input) {
  const s = String(input || '').trim();
  let id = CHANNEL_ID.test(s) ? s : null;
  if (!id) {
    const url = /^https:\/\/(www\.)?youtube\.com\//.test(s) ? s : /^@?[\w.-]{3,}$/.test(s) ? `https://www.youtube.com/${s.startsWith('@') ? s : `@${s}`}` : null;
    if (!url) throw new Error('Enter a YouTube @handle, channel URL or UC… channel id');
    const html = await fetchText(url);
    id = (/"externalId":"(UC[A-Za-z0-9_-]{22})"/.exec(html) || /channel_id=(UC[A-Za-z0-9_-]{22})/.exec(html) || [])[1];
    if (!id) throw new Error('Could not find that channel');
  }
  const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
  const feed = parseFeed(xml);
  const name = decode((/<title>([^<]*)<\/title>/.exec(xml) || [])[1] || '') || id;
  return { id, name, latest: feed[0]?.title || null };
}

// ----------------------------------------------------------------- messages
const handlers = {
  async 'get-data'() {
    const d = await chrome.storage.local.get(['builds', 'videos', 'state', 'settings', 'perkCache']);
    const s = { ...DEFAULTS, ...(d.settings || {}) };
    return { builds: d.builds || [], videos: d.videos || [], state: d.state || null, settings: { siteUrl: s.siteUrl, intervalMinutes: s.intervalMinutes, lastCheck: d.state?.lastCheck || null, channels: s.channels.length }, perksVersion: d.perkCache?.version || null };
  },
  async 'check-now'() { return runCheck('manual'); },
  async 'site-seen'(msg, sender) {
    // the archive page told us where it lives; only accept it from a real tab
    if (!sender.tab || typeof msg.url !== 'string') return { ok: false };
    const u = new URL(msg.url);
    if (!/^https?:$/.test(u.protocol)) return { ok: false };
    const site = `${u.origin}${u.pathname.replace(/[^/]*$/, '')}`;
    const s = await settings();
    if (!s.siteUrl) { await chrome.storage.local.set({ settings: { ...s, siteUrl: site } }); return { ok: true, learned: site }; }
    return { ok: true };
  },
  async 'seen-finds'() { await chrome.storage.local.set({ unseen: 0 }); await setBadge(); return { ok: true }; },
  async 'scan-video'(msg) { return scanVideo(msg.id); },
  async 'is-dbd'(msg) { return isDbd(msg); },
  async 'detect-text'(msg) { return detectText(msg); },
  async 'save-build'(msg) {
    const b = msg.build;
    const { perkCache } = await chrome.storage.local.get('perkCache');
    const known = new Set((perkCache?.perks || []).map((p) => p.id));
    if (!b || !Array.isArray(b.perks) || b.perks.length !== 4 || !b.perks.every((id) => known.has(id)) || !VIDEO_ID.test(b.video || '')) throw new Error('invalid build');
    const added = await saveFinds([{ ...b, saved: true }]);
    return { ok: true, added: added.length };
  },
  async 'delete-build'(msg) {
    const { builds = [] } = await chrome.storage.local.get('builds');
    await chrome.storage.local.set({ builds: builds.filter((b) => b.id !== msg.id) });
    return { ok: true };
  },
  async 'resolve-channel'(msg) { return resolveChannel(msg.input); },
  async 'reschedule'() { await schedule(); return { ok: true }; },
  async 'clear-finds'() { await chrome.storage.local.set({ builds: [], videos: [], seen: [], unseen: 0 }); await setBadge(); return { ok: true }; },
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  // only our own pages and content scripts can talk to the worker
  if (sender.id !== chrome.runtime.id) return false;
  h(msg, sender).then((r) => reply({ ok: true, data: r }), (err) => reply({ ok: false, error: err.message }));
  return true;
});
