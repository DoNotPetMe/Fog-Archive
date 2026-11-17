// Fog Archive — application shell: data loading, routing, the Builds view.

import { store, $, $$, esc, fmt, perkHtml, loadoutHtml, perkDescHtml, perkOwner, akaHtml, initTooltips, openModal, closeModal, modalOpen, toast, drBadge, drPanelHtml, CLAW, timeAgo } from './ui.js';
import { initEmbers, initEntity, skillCheck } from './entity.js';
import { indexBuilds, filterBuilds } from './engine/query.mjs';
import { analyseBuild } from './engine/stacking.mjs';
import { deriveTags, tagLabel, tagGroup } from './engine/tags.mjs';
import { autoSummary } from './engine/factcheck.mjs';
import { slugify } from './engine/text.mjs';
import { renderPerks, renderLab, renderVideos, renderChanges, renderSources } from './views.js';

const API = 'api/v1/';
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MY_KEY = 'fog.mybuilds.v1';

// ------------------------------------------------------------------- data
async function getJson(name) {
  const res = await fetch(API + name, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json();
}

export function loadMyBuilds() {
  try { const v = JSON.parse(localStorage.getItem(MY_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function saveMyBuilds(list) {
  try { localStorage.setItem(MY_KEY, JSON.stringify(list.slice(0, 500))); } catch { toast('Could not save in this browser'); }
}

/** Turn a locally saved / extension-captured build into the same shape the API serves. */
function normaliseLocal(raw, origin) {
  if (!raw || typeof raw !== 'object') return null;
  const ids = Array.isArray(raw.perks) ? raw.perks.filter((id) => typeof id === 'string' && store.perkById.has(id)) : [];
  if (ids.length !== 4 || new Set(ids).size !== 4) return null;
  const ps = ids.map((id) => store.perkById.get(id));
  const role = ps[0].role;
  if (ps.some((p) => p.role !== role)) return null;
  const k = role === 'killer' && raw.killer ? store.killerById.get(String(raw.killer)) : null;
  const vid = typeof raw.video === 'string' && VIDEO_ID.test(raw.video) ? raw.video : null;
  const title = String(raw.title || 'Untitled build').slice(0, 120);
  const b = {
    id: `${origin}-${slugify(String(raw.id || title)).slice(0, 60)}`,
    title, role, killer: k ? { id: k.id, name: k.name } : null, perks: ids, layout: null, alts: {},
    categories: [], summary: String(raw.notes || raw.summary || '').slice(0, 600), details: '', tips: [],
    source: origin === 'ext' ? { id: 'extension', name: 'Found with the extension', url: vid ? `https://www.youtube.com/watch?v=${vid}` : null } : { id: 'mine', name: 'My builds', url: null },
    video: vid ? { id: vid, title: String(raw.videoTitle || '').slice(0, 200), channel: String(raw.channel || '').slice(0, 100) } : null,
    local: origin, rawId: raw.id,
    detection: origin === 'ext' && raw.foundIn ? { from: String(raw.foundIn), confidence: ['high', 'medium', 'low'].includes(raw.confidence) ? raw.confidence : 'low', risk: raw.risk ? String(raw.risk).slice(0, 80) : null } : null,
  };
  b.dr = analyseBuild(ps, store.rules, { role, killer: k });
  b.tags = deriveTags({ ...b, tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 12).map(String) : [] }, ps);
  if (b.dr.status === 'active') b.tags.push('diminishing-returns');
  b.tags.push('mine');
  if (k) b.tags.push(`killer:${slugify(k.name.replace(/^The /i, ''))}`);
  return b;
}

let apiBuilds = [];
export function rebuildBuildList() {
  const mine = loadMyBuilds().map((b) => normaliseLocal(b, 'mine')).filter(Boolean);
  const ext = store.ext.builds.map((b) => normaliseLocal(b, 'ext')).filter(Boolean);
  store.builds = [...mine, ...ext, ...apiBuilds];
  store.buildById = new Map(store.builds.map((b) => [b.id, b]));
  // a video with several builds is shown as one multi-build card
  store.videoGroups = new Map();
  for (const b of store.builds) {
    const v = b.video?.id;
    if (!v) continue;
    if (!store.videoGroups.has(v)) store.videoGroups.set(v, []);
    store.videoGroups.get(v).push(b);
  }
  for (const [v, list] of store.videoGroups) {
    const seen = new Set(); // the same build found by the archive and the extension counts once
    const uniq = list.filter((b) => { const k = [...b.perks].sort().join('|'); if (seen.has(k)) return false; seen.add(k); return true; });
    if (uniq.length < 2) { store.videoGroups.delete(v); continue; }
    store.videoGroups.set(v, uniq);
    for (const b of uniq) if (!b.tags.includes('multi-build')) b.tags.push('multi-build');
  }
  indexBuilds(store.builds, store.perkById);
}

async function loadAll() {
  const [meta, perks, chars, builds, tags, videos, changelog, rules] = await Promise.all([
    getJson('meta.json'), getJson('perks.json'), getJson('characters.json'), getJson('builds.json'),
    getJson('tags.json'), getJson('videos.json').catch(() => ({ videos: [] })),
    getJson('changelog.json').catch(() => ({ entries: [] })), getJson('rules.json').catch(() => ({ rules: [] })),
  ]);
  store.meta = meta;
  store.perks = perks.perks;
  store.perkById = new Map(store.perks.map((p) => [p.id, p]));
  store.characters = chars.characters;
  store.killers = store.characters.filter((c) => c.role === 'killer');
  store.killerById = new Map(store.killers.map((c) => [c.id, c]));
  store.tags = tags.tags;
  store.videos = videos.videos || [];
  store.changelog = changelog;
  store.rules = rules;
  apiBuilds = builds.builds;
  rebuildBuildList();
}

function renderStatus() {
  const m = store.meta;
  const bad = (m.sources || []).some((s) => s.status === 'error' || s.status === 'partial');
  $('#status').classList.toggle('warn', bad);
  $('#status-text').textContent = `Patch ${m.gameVersion || '?'} · checked ${timeAgo(m.checkedAt)}${store.ext.connected ? ' · extension linked' : ''}`;
}

// ----------------------------------------------------------------- routing
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  return { view: path.split('/')[0] || 'builds', params: new URLSearchParams(query) };
}
export function setHash(view, params, replace = false) {
  const q = params && [...params.keys()].length ? `?${params.toString()}` : '';
  const url = `#/${view}${q}`;
  if (replace) history.replaceState(null, '', url); else location.hash = url;
  if (replace) onRoute();
}
let currentView = null;
function onRoute() {
  const { view, params } = parseHash();
  $$('.tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === view));
  const main = $('#view');
  if (view !== 'builds' && modalOpen() && !params.get('p')) closeModal(true);
  const fresh = currentView !== view;
  currentView = view;
  if (fresh) scrollTo({ top: 0 });
  if (view === 'perks') renderPerks(main, params, fresh);
  else if (view === 'lab') renderLab(main, params, fresh);
  else if (view === 'videos') renderVideos(main, params);
  else if (view === 'changes') renderChanges(main, params);
  else if (view === 'sources') renderSources(main, params);
  else renderBuilds(main, params, fresh);
}

// ------------------------------------------------------------- Builds view
const CATS = [['meta', 'Meta'], ['toxic', 'Toxic'], ['fun', 'Fun'], ['recommended', 'Recommended'], ['beginner', 'Beginner']];
const PAGE = 48;
let shown = PAGE;
let lastKey = '';

function filtersFrom(params) {
  return {
    q: params.get('q') || '',
    role: ['killer', 'survivor'].includes(params.get('role')) ? params.get('role') : '',
    tags: (params.get('tags') || '').split(',').filter(Boolean),
    killer: params.get('killer') || '',
    sort: params.get('sort') || 'featured',
  };
}
function paramsFrom(f, extra = {}) {
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.role) p.set('role', f.role);
  if (f.tags.length) p.set('tags', f.tags.join(','));
  if (f.killer) p.set('killer', f.killer);
  if (f.sort && f.sort !== 'featured') p.set('sort', f.sort);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return p;
}
function currentResults(f) {
  let list = filterBuilds(store.builds, { q: f.q, role: f.role, killer: f.killer, tags: f.tags });
  if (f.sort === 'title') list = [...list].sort((a, b) => a.title.localeCompare(b.title));
  else if (f.sort === 'killer') list = [...list].sort((a, b) => (a.killer?.name || (a.role === 'survivor' ? 'zz' : 'a')).localeCompare(b.killer?.name || (b.role === 'survivor' ? 'zz' : 'a')));
  return list;
}

function catBadges(b) {
  let h = '';
  if (b.local) h += `<span class="badge mine">${b.local === 'ext' ? 'Extension' : 'Mine'}</span>`;
  for (const c of b.categories || []) h += `<span class="badge ${esc(c)}">${esc(tagLabel(c))}</span>`;
  if (b.tags.includes('beginner') && !(b.categories || []).includes('beginner')) h += '<span class="badge beginner">Beginner</span>';
  return h;
}

function whoHtml(b) {
  if (b.killer) {
    const k = store.killerById.get(b.killer.id);
    return `<div class="who">${k?.portrait ? `<img src="${esc(k.portrait)}" alt="" loading="lazy" width="22" height="22">` : '<span class="dot"></span>'}${esc(b.killer.name)}</div>`;
  }
  return `<div class="who"><span class="dot"></span>${b.role === 'killer' ? 'Any killer' : `Survivor${b.group ? ` · ${esc(b.group)}` : ''}`}</div>`;
}

/** Is this build's write-up safe to show? Local builds are the user's own notes. */
function writeupOk(b) {
  if (b.local) return true;
  return !b.check || b.check.status === 'verified';
}
function summaryOf(b) {
  if (writeupOk(b) && b.summary) return b.summary;
  return autoSummary(b, b.perks.map((id) => store.perkById.get(id)).filter(Boolean), tagLabel);
}

function factCheckHtml(b) {
  if (b.local) return `<div class="fc fc-local"><b>Your notes</b> — not fact-checked.</div>`;
  const c = b.check;
  if (!c || c.status === 'none') return '';
  if (c.status === 'verified') {
    return `<div class="fc fc-ok"><i class="lamp"></i><span><b>Fact-checked</b> against the live perk text for patch ${esc(c.patch || '?')}${c.reviewed ? `, reviewed ${esc(c.reviewed)}` : ''}. Numbers come straight from the game data.</span></div>`;
  }
  const issues = (c.issues || []).filter((i) => i.severity !== 'info');
  const head = c.status === 'stale' ? 'Waiting for a re-check' : 'Did not pass the fact check';
  return `<div class="fc fc-bad"><div class="fc-head"><i class="lamp"></i><b>${head}</b> — showing a summary generated from the perks instead.</div>
    <ul>${issues.map((i) => `<li><span class="fc-rule">${esc(i.field)}</span> ${esc(i.message)}${i.clause ? `<q>${esc(i.clause)}</q>` : ''}</li>`).join('')}</ul>
    <button class="linkish" id="fc-show" aria-expanded="false">Show the unverified write-up anyway</button></div>`;
}

const FOUND = { description: 'video description', title: 'video title', 'youtube-ai': "YouTube's AI answer", 'creator-comment': "creator's comment", comment: 'viewer comment' };
function foundBadge(b) {
  const d = b.detection;
  if (!d?.from) return '';
  const conf = d.confidence || (d.from === 'comment' ? 'low' : d.from === 'youtube-ai' || d.from === 'creator-comment' ? 'medium' : 'high');
  return `<span class="badge found found-${conf}" title="${conf === 'low' ? 'Risky: only from comments' : conf === 'medium' ? 'From an AI answer or comment: check the video' : 'Written by the creator'}">From ${esc(FOUND[d.from] || d.from)}${conf === 'low' ? ' · risky' : ''}</span>`;
}

function cardHtml(b) {
  return `<article class="card ${b.role}" tabindex="0" role="button" data-build="${esc(b.id)}" aria-label="${esc(b.title)}${b.killer ? `, ${esc(b.killer.name)}` : ''}">
    ${CLAW('tr')}${CLAW('bl')}
    ${loadoutHtml(b.perks, { layout: b.layout })}
    <div class="card-body">${whoHtml(b)}<h3>${esc(b.title)}</h3><p>${esc(summaryOf(b))}</p>
      <div class="badges">${catBadges(b)}${foundBadge(b)}${drBadge(b.dr)}${b.video ? '<span class="badge video"><svg viewBox="0 0 10 10"><path fill="currentColor" d="M2 1v8l7-4z"/></svg>Video</span>' : ''}${b.changed ? '<span class="badge changed" title="A perk in this build changed recently">Perk changed</span>' : ''}</div>
    </div></article>`;
}

function chip(tag, label, count, on, cls = '') {
  return `<button class="chip ${cls} ${on ? 'on' : ''}" data-tag="${esc(tag)}" aria-pressed="${on}">${esc(label)}${count != null ? `<i>${count}</i>` : ''}</button>`;
}

function renderBuilds(main, params, fresh) {
  const f = filtersFrom(params);
  if (fresh || !$('.hero', main)) {
    const countOf = (t) => store.builds.filter((b) => b.tags.includes(t)).length;
    const styleTags = store.tags.filter((t) => ['style', 'mechanic'].includes(t.group) && t.count >= 2 && t.id !== 'diminishing-returns');
    const mineCount = countOf('mine');
    main.innerHTML = `
      <section class="hero">
        <div class="hero-row">
          <label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
            <input id="q" type="search" placeholder="Search builds, perks, killers, creators…" autocomplete="off" spellcheck="false" aria-label="Search builds"><kbd>/</kbd></label>
          <div class="seg" role="group" aria-label="Role">
            <button data-role="">All</button><button data-role="killer">Killer</button><button data-role="survivor">Survivor</button>
          </div>
          <button class="btn offer" id="offer" title="Hit the skill check and the Entity picks a build for you">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 12V4" stroke-linecap="round"/><path d="M19 8a9 9 0 0 1 2 4" stroke-width="5"/></svg>Offer to the Entity</button>
        </div>
        <div class="chips" id="cats"><span class="chip-label">Category</span>
          ${CATS.map(([id, label]) => chip(id, label, countOf(id), false, `cat-${id}`)).join('')}
          ${chip('video', 'Has video', countOf('video'), false)}${chip('diminishing-returns', 'Diminishing returns', countOf('diminishing-returns'), false)}
          ${store.videoGroups.size ? chip('multi-build', 'Multi-build videos', store.videoGroups.size, false, 'cat-multi') : ''}
          ${mineCount ? chip('mine', 'My builds', mineCount, false) : ''}
        </div>
        <div class="killers" id="killers" aria-label="Filter by killer">
          <button class="killer-pick any" data-killer=""><div class="killer-any">ALL</div><span>Any killer</span></button>
          ${store.killers.map((k) => `<button class="killer-pick" data-killer="${esc(k.id)}" title="${esc(k.name)}">${k.portrait ? `<img src="${esc(k.portrait)}" alt="" loading="lazy" width="58" height="58">` : `<div class="killer-any">${esc(k.name.replace(/^The /, '').slice(0, 3))}</div>`}<span>${esc(k.name.replace(/^The /, ''))}</span></button>`).join('')}
        </div>
        <div class="chips" id="tags"><span class="chip-label">Tags</span>
          ${styleTags.slice(0, 16).map((t) => chip(t.id, t.label, t.count, false)).join('')}
          <span class="tag-more" id="tag-more">${styleTags.slice(16).map((t) => chip(t.id, t.label, t.count, false)).join('')}</span>
          ${styleTags.length > 16 ? '<button class="linkish" id="tag-toggle" aria-expanded="false">More tags</button>' : ''}
        </div>
      </section>
      <div class="results-bar"><span><b id="count">0</b> builds</span><span id="active"></span><span class="spacer"></span>
        <label>Sort <select id="sort"><option value="featured">Featured</option><option value="title">Title A–Z</option><option value="killer">Killer</option></select></label></div>
      <section class="grid" id="grid" aria-live="polite"></section>
      <div class="more-row"><button class="btn" id="more" hidden>Show more builds</button></div>`;
    wireBuilds(main);
  }

  // reflect state in the controls
  const q = $('#q', main);
  if (document.activeElement !== q) q.value = f.q;
  $$('.seg button', main).forEach((b) => b.classList.toggle('on', b.dataset.role === f.role));
  $$('.chip', main).forEach((c) => { const on = f.tags.includes(c.dataset.tag); c.classList.toggle('on', on); c.setAttribute('aria-pressed', on); });
  $('#killers', main).hidden = f.role === 'survivor';
  $$('.killer-pick', main).forEach((k) => k.classList.toggle('on', k.dataset.killer === f.killer));
  $('#sort', main).value = f.sort;

  const key = JSON.stringify(f);
  if (key !== lastKey) { shown = PAGE; lastKey = key; }
  const list = currentResults(f);
  $('#count', main).textContent = list.length;
  const active = f.q || f.role || f.tags.length || f.killer;
  $('#active', main).innerHTML = active ? '<button class="linkish" id="clear">Clear filters</button>' : '';
  const grid = $('#grid', main);
  const items = groupItems(list);
  grid.innerHTML = list.length
    ? items.slice(0, shown).map((it) => (it.group ? groupCardHtml(it) : cardHtml(it.build))).join('')
    : '<div class="empty-state" style="grid-column:1/-1"><h3>The fog gives nothing back</h3><p>No build matches those filters. Try fewer tags or a different search.</p></div>';
  $('#more', main).hidden = items.length <= shown;

  // build detail lives in the URL too, so links to a build can be shared
  const open = params.get('b');
  const openV = params.get('v');
  if (open && store.buildById.has(open)) showBuild(store.buildById.get(open));
  else if (openV && store.videoGroups.has(openV)) showGroup(openV);
  else if (modalOpen() && !open) closeModal(true);
}

function wireBuilds(main) {
  const update = (mut, replace = false) => {
    const { params } = parseHash();
    const f = filtersFrom(params);
    mut(f);
    setHash('builds', paramsFrom(f), replace);
  };
  let t;
  $('#q', main).addEventListener('input', (e) => { clearTimeout(t); const v = e.target.value; t = setTimeout(() => update((f) => { f.q = v.trim(); }, true), 140); });
  $$('.seg button', main).forEach((b) => b.addEventListener('click', () => update((f) => { f.role = b.dataset.role; if (f.role === 'survivor') f.killer = ''; })));
  main.addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (c && main.contains(c)) return update((f) => { f.tags = f.tags.includes(c.dataset.tag) ? f.tags.filter((x) => x !== c.dataset.tag) : [...f.tags, c.dataset.tag]; });
    const k = e.target.closest('.killer-pick');
    if (k) return update((f) => { f.killer = f.killer === k.dataset.killer ? '' : k.dataset.killer; if (f.killer) f.role = 'killer'; });
    if (e.target.id === 'clear') return setHash('builds', new URLSearchParams());
    if (e.target.id === 'tag-toggle') { const m = $('#tag-more', main); const open = m.classList.toggle('open'); e.target.textContent = open ? 'Fewer tags' : 'More tags'; e.target.setAttribute('aria-expanded', open); return; }
    if (e.target.id === 'more') { shown += PAGE; lastKey = JSON.stringify(filtersFrom(parseHash().params)); return onRoute(); }
    const card = e.target.closest('.card');
    if (card) (card.dataset.video ? openGroup(card.dataset.video) : openBuild(card.dataset.build));
  });
  main.addEventListener('keydown', (e) => {
    const card = e.target.closest?.('.card');
    if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); card.dataset.video ? openGroup(card.dataset.video) : openBuild(card.dataset.build); }
  });
  $('#sort', main).addEventListener('change', (e) => update((f) => { f.sort = e.target.value; }));
  $('#offer', main).addEventListener('click', async () => {
    const list = currentResults(filtersFrom(parseHash().params));
    if (!list.length) return toast('Nothing to offer — clear a filter first');
    const grade = await skillCheck({ hint: 'Stop the needle in the white zone. A great skill check earns a build with a video.' });
    if (grade === 'cancel') return;
    let pool = list;
    if (grade === 'great') { const v = list.filter((b) => b.video); if (v.length) pool = v; }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    toast(grade === 'great' ? 'Great skill check — the Entity is pleased' : grade === 'good' ? 'The Entity accepts your offering' : 'The Entity is displeased… but shows you something anyway');
    openBuild(pick.id);
  });
}

const cleanVideoTitle = (t) => String(t || '').replace(/\s*\|\s*dead by daylight.*$/i, '').trim();
function videoInfo(builds) {
  const b = builds.find((x) => x.video?.title) || builds[0];
  return { title: cleanVideoTitle(b.video?.title || b.detection?.videoTitle || b.title), channel: b.video?.channel || b.source?.name || '' };
}

function groupItems(list) {
  const out = [];
  const done = new Set();
  for (const b of list) {
    const v = b.video?.id;
    if (v && store.videoGroups.has(v)) {
      if (done.has(v)) continue;
      done.add(v);
      out.push({ group: v, builds: store.videoGroups.get(v) });
    } else out.push({ build: b });
  }
  return out;
}

function groupCardHtml({ group: vid, builds }) {
  const { title, channel } = videoInfo(builds);
  const killers = [...new Set(builds.map((b) => b.killer?.name).filter(Boolean))].map((k) => k.replace(/^The /, ''));
  const role = builds.every((b) => b.role === 'survivor') ? 'survivor' : 'killer';
  const cats = [...new Set(builds.flatMap((b) => b.categories || []))];
  return `<article class="card group ${role}" tabindex="0" role="button" data-video="${esc(vid)}" aria-label="${esc(title)}: ${builds.length} builds">
    ${CLAW('tr')}${CLAW('bl')}
    <div class="vthumb"><img src="https://i.ytimg.com/vi/${esc(vid)}/mqdefault.jpg" alt="" loading="lazy" width="320" height="180"><span class="multi-ribbon">${builds.length} builds</span></div>
    <div class="card-body"><div class="who"><span class="dot"></span>${esc(channel)}${killers.length ? ` · ${esc(killers.slice(0, 3).join(', '))}${killers.length > 3 ? '…' : ''}` : ''}</div>
      <h3>${esc(title)}</h3>
      <div class="mini-loadouts">${builds.slice(0, 4).map((b) => loadoutHtml(b.perks, { layout: b.layout, size: 26 })).join('')}${builds.length > 4 ? `<span class="more-n">+${builds.length - 4}</span>` : ''}</div>
      <div class="badges"><span class="badge multi">Multi-build · ${builds.length}</span>${cats.map((c) => `<span class="badge ${esc(c)}">${esc(tagLabel(c))}</span>`).join('')}</div>
    </div></article>`;
}

/** A short line per build: a short checked write-up, or the summary built from the perks. */
function briefOf(b) {
  if (writeupOk(b) && b.summary && b.summary.length <= 170) return b.summary;
  return autoSummary(b, b.perks.map((id) => store.perkById.get(id)).filter(Boolean), tagLabel);
}
function buildLabel(b, videoTitle, i) {
  const t = String(b.title || '');
  const rest = t.startsWith(videoTitle) ? t.slice(videoTitle.length).replace(/^\s*\((.+)\)\s*$/, '$1').trim() : t;
  return rest && rest !== videoTitle ? rest : `Build ${i + 1}`;
}

function openGroup(vid) {
  const { params } = parseHash();
  setHash('builds', paramsFrom(filtersFrom(params), { v: vid }));
}

function showGroup(vid) {
  const builds = store.videoGroups.get(vid);
  const { title, channel } = videoInfo(builds);
  const rows = builds.map((b, i) => `<div class="gb ${b.role}">
      ${loadoutHtml(b.perks, { layout: b.layout, size: 58 })}
      <div class="gb-body"><div class="who">${b.killer ? esc(b.killer.name) : b.role === 'killer' ? 'Any killer' : 'Survivor'}</div>
        <h4>${esc(buildLabel(b, title, i))}</h4><p>${esc(briefOf(b))}</p>
        <div class="badges">${foundBadge(b)}${drBadge(b.dr)}${b.local ? '<span class="badge mine">Extension</span>' : ''}</div></div>
      <button class="btn small" data-open-build="${esc(b.id)}">Full details</button></div>`).join('');
  const html = `<div class="group-head">
      <div class="video" data-video="${esc(vid)}"><button aria-label="Play video: ${esc(title)}"><img src="https://i.ytimg.com/vi/${esc(vid)}/hqdefault.jpg" alt="" loading="lazy"><span class="play"></span></button></div>
      <div><div class="who">${esc(channel)} · ${builds.length} builds in this video</div><h2>${esc(title)}</h2>
        <p class="summary">Each build is kept to one line here. Open one for its perks, diminishing returns and full write-up.</p>
        <a class="btn small" href="https://www.youtube.com/watch?v=${esc(vid)}" target="_blank" rel="noopener noreferrer">Watch on YouTube</a></div>
    </div><div class="group-list">${rows}</div>`;
  const modal = openModal(html, { cls: 'group', label: title, onClose: () => { const { params } = parseHash(); if (params.get('v')) setHash('builds', paramsFrom(filtersFrom(params)), true); } });
  modal.addEventListener('click', (e) => { const o = e.target.closest('[data-open-build]'); if (o) openBuild(o.dataset.openBuild); });
  const v = $('.video', modal);
  v?.querySelector('button').addEventListener('click', () => {
    if (!VIDEO_ID.test(vid)) return;
    v.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${vid}?autoplay=1&rel=0" title="Build video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  });
}

function openBuild(id) {
  const { params } = parseHash();
  const p = paramsFrom(filtersFrom(params), { b: id });
  setHash('builds', p);
}

function showBuild(b) {
  const k = b.killer ? store.killerById.get(b.killer.id) : null;
  const perks = b.perks.map((id) => store.perkById.get(id));
  const perkRows = perks.map((p) => {
    const alts = (b.alts?.[p.id] || []).map((id) => store.perkById.get(id)).filter(Boolean);
    return `<div class="perk-row">${perkHtml(p, { attrs: 'style="--w:74px"' })}<div>
      <h4>${esc(p.name)} <small>${esc(perkOwner(p))}</small></h4>${akaHtml(p)}
      <div class="desc">${perkDescHtml(p)}</div>
      ${alts.length ? `<div class="alts">Swap for ${alts.map((a) => perkHtml(a, { attrs: 'style="--w:44px"' })).join('')}</div>` : ''}
    </div></div>`;
  }).join('');
  const tags = b.tags.filter((t) => !t.startsWith('source:') && !t.startsWith('killer:') && !(b.categories || []).includes(t));
  const changed = (b.changed || []).map((c) => { const p = store.perkById.get(c.perk); return p ? `<li><b>${esc(p.name)}</b> ${esc(c.type)} on ${esc(c.date)} (patch ${esc(c.version || '?')}) — <a href="#/changes">see what changed</a></li>` : ''; }).join('');
  const video = b.video ? `<div class="section"><h3 class="section-title">Video</h3>
      <div class="video" data-video="${esc(b.video.id)}"><button aria-label="Play video: ${esc(b.video.title || b.title)}"><img src="https://i.ytimg.com/vi/${esc(b.video.id)}/hqdefault.jpg" alt="" loading="lazy"><span class="play"></span></button></div>
      <div class="video-meta">${b.video.title ? `${esc(b.video.title)} · ` : ''}${b.video.channel ? `<b>${esc(b.video.channel)}</b> · ` : ''}<a href="https://www.youtube.com/watch?v=${esc(b.video.id)}" target="_blank" rel="noopener noreferrer">Watch on YouTube</a></div></div>` : '';
  const html = `
    <div class="modal-head">
      ${k?.portrait ? `<img class="portrait" src="${esc(k.portrait)}" alt="">` : ''}
      ${loadoutHtml(b.perks, { layout: b.layout, size: 104 })}
      <div><div class="who">${b.killer ? esc(b.killer.name) : b.role === 'killer' ? 'Any killer' : 'Survivor'} · ${b.role} build</div>
        <h2>${esc(b.title)}</h2>
        <p class="summary">${esc(summaryOf(b))}</p>
        <div class="tagline">${catBadges(b)}${tags.map((t) => `<a class="chip" href="#/builds?tags=${encodeURIComponent(t)}">${esc(tagLabel(t))}</a>`).join('')}</div>
      </div>
    </div>
    <div class="modal-body">
      <div class="modal-col">
        <div class="section"><h3 class="section-title">Perks</h3>${perkRows}</div>
        ${b.details || b.tips?.length || (b.summary && !writeupOk(b)) ? `<div class="section details"><h3 class="section-title">How it plays</h3>${factCheckHtml(b)}<div class="writeup" ${writeupOk(b) ? '' : 'hidden'}>${!writeupOk(b) && b.summary ? `<p><b>Summary:</b> ${esc(b.summary)}</p>` : ''}${b.details ? `<p>${esc(b.details)}</p>` : ''}${b.tips?.length ? `<ul class="tips">${b.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}</div></div>` : ''}
      </div>
      <div class="modal-col">
        ${video}
        <div class="section"><h3 class="section-title">Diminishing returns</h3>${drPanelHtml(b.dr)}</div>
        ${changed ? `<div class="section"><h3 class="section-title">Recent perk changes</h3><ul class="tips">${changed}</ul></div>` : ''}
        ${b.evidence ? `<div class="section"><h3 class="section-title">Why it counts as meta</h3><p class="muted">${esc(b.evidence)}</p></div>` : ''}
        <div class="section"><h3 class="section-title">Source</h3>
          <div class="source-line">${b.source?.url ? `<a href="${esc(b.source.url)}" target="_blank" rel="noopener noreferrer">${esc(b.source.name)}</a>` : esc(b.source?.name || 'Unknown')}${b.source?.date ? `<span>· ${esc(b.source.date)}</span>` : ''}${b.detection?.from ? `<span>· found in the ${esc(FOUND[b.detection.from] || b.detection.from)}${b.detection.risk ? ` (${esc(b.detection.risk)})` : ''}</span>` : ''}<span>· values shown are live for patch ${esc(store.meta.gameVersion || '?')}</span></div>
          ${b.video && store.videoGroups.has(b.video.id) ? `<p class="muted" style="margin:10px 0 0">This build is one of ${store.videoGroups.get(b.video.id).length} in its video. <a class="linkish" href="#/builds?v=${esc(b.video.id)}">See all of them</a></p>` : ''}
          <div class="row" style="margin-top:12px"><a class="btn small" href="#/lab?${new URLSearchParams({ p: b.perks.join(','), ...(k ? { k: k.id } : {}), ...(b.video ? { v: b.video.id } : {}) }).toString()}">Open in Build Lab</a><button class="btn small ghost" id="copy-link">Copy link</button>${b.local === 'mine' ? '<button class="btn small ghost" id="del-build">Delete</button>' : ''}</div>
        </div>
      </div>
    </div>`;
  const modal = openModal(html, {
    cls: b.role, label: b.title,
    onClose: () => { const { params } = parseHash(); if (params.get('b')) setHash('builds', paramsFrom(filtersFrom(params)), true); },
  });
  $('#fc-show', modal)?.addEventListener('click', (e) => {
    const w = $('.writeup', modal);
    w.hidden = !w.hidden;
    e.target.setAttribute('aria-expanded', String(!w.hidden));
    e.target.textContent = w.hidden ? 'Show the unverified write-up anyway' : 'Hide the unverified write-up';
  });
  const v = $('.video', modal);
  v?.querySelector('button').addEventListener('click', () => {
    const id = v.dataset.video;
    if (!VIDEO_ID.test(id)) return;
    v.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0" title="Build video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  });
  $('#copy-link', modal)?.addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#/builds?b=${encodeURIComponent(b.id)}`;
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast(url); }
  });
  $('#del-build', modal)?.addEventListener('click', () => {
    saveMyBuilds(loadMyBuilds().filter((x) => x.id !== b.rawId));
    rebuildBuildList(); closeModal(true); setHash('builds', paramsFrom(filtersFrom(parseHash().params)), true); toast('Build deleted');
  });
}

// -------------------------------------------------- extension bridge
// The companion extension injects found videos / captured builds. Everything
// it sends is treated as untrusted and validated in normaliseLocal().
function initBridge() {
  addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.source !== 'fog-archive-ext' || d.type !== 'data') return;
    store.ext.connected = true;
    store.ext.videos = Array.isArray(d.videos) ? d.videos.filter((v) => v && VIDEO_ID.test(v.id)).slice(0, 300) : [];
    store.ext.builds = Array.isArray(d.builds) ? d.builds.slice(0, 500) : [];
    store.ext.settings = d.settings && typeof d.settings === 'object' ? d.settings : null;
    rebuildBuildList();
    renderStatus();
    currentView = null; // force the current view to redraw with the new data
    onRoute();
  });
  const hello = () => postMessage({ source: 'fog-archive', type: 'hello' }, location.origin);
  hello();
  setTimeout(hello, 1200);
}
export function askExtension(type, payload = {}) {
  postMessage({ source: 'fog-archive', type, ...payload }, location.origin);
}

// -------------------------------------------------------------------- boot
async function boot() {
  initTooltips();
  initEmbers();
  initEntity();
  try {
    await loadAll();
  } catch (err) {
    $('#view').innerHTML = `<div class="empty-state"><h3>The archive is unreachable</h3><p>${esc(err.message)}</p><p class="muted">If you opened this file directly, run <code>node server.mjs</code> and open http://localhost:4173/ instead.</p></div>`;
    return;
  }
  renderStatus();
  addEventListener('hashchange', onRoute);
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/input|textarea|select/i.test(document.activeElement?.tagName || '') && !modalOpen()) {
      const q = $('#q') || $('#pq');
      if (q) { e.preventDefault(); q.focus(); }
    }
  });
  initBridge();
  onRoute();
}
boot();

export { onRoute, parseHash, fmt, tagGroup };
