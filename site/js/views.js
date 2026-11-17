// Fog Archive — secondary views: Perks, Build Lab, Videos, Changes, Sources.

import { store, $, $$, esc, fmt, perkHtml, loadoutHtml, perkDescHtml, perkOwner, akaHtml, openModal, closeModal, toast, drPanelHtml, timeAgo } from './ui.js';
import { setHash, loadMyBuilds, saveMyBuilds, rebuildBuildList, askExtension } from './app.js';
import { analyseBuild } from './engine/stacking.mjs';
import { deriveTags, tagLabel } from './engine/tags.mjs';
import { normName } from './engine/text.mjs';

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const roleSeg = (role) => `<div class="seg" role="group" aria-label="Role"><button data-role="" class="${role ? '' : 'on'}">All</button><button data-role="killer" class="${role === 'killer' ? 'on' : ''}">Killer</button><button data-role="survivor" class="${role === 'survivor' ? 'on' : ''}">Survivor</button></div>`;

function matchPerk(p, q) {
  if (!q) return true;
  const hay = `${p.name} ${(p.altNames || []).join(' ')} ${p.character?.name || ''} ${p.text}`.toLowerCase();
  return q.split(/\s+/).every((t) => hay.includes(t) || normName(hay).includes(normName(t)));
}

// ------------------------------------------------------------------- Perks
export function renderPerks(main, params, fresh) {
  const q = (params.get('q') || '').toLowerCase().trim();
  const role = params.get('role') || '';
  if (fresh || !$('#pq', main)) {
    main.innerHTML = `<div class="page-head"><h1>Perk codex</h1><p>All ${store.perks.length} perks with the values live in patch ${esc(store.meta.gameVersion || '?')}. Hover a perk for its text; open it for every tier and the builds that use it.</p></div>
      <section class="hero"><div class="hero-row">
        <label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input id="pq" type="search" placeholder="Search perks by name, owner or effect…" autocomplete="off" aria-label="Search perks"><kbd>/</kbd></label>
        ${roleSeg(role)}</div></section>
      <div class="results-bar"><span><b id="pcount">0</b> perks</span></div><section class="perk-grid" id="pgrid"></section>`;
    let t;
    const go = (mut) => { const p = new URLSearchParams(location.hash.split('?')[1] || ''); mut(p); p.delete('p'); setHash('perks', p, true); };
    $('#pq', main).addEventListener('input', (e) => { clearTimeout(t); const v = e.target.value.trim(); t = setTimeout(() => go((p) => (v ? p.set('q', v) : p.delete('q'))), 140); });
    main.addEventListener('click', (e) => {
      const b = e.target.closest('.seg button');
      if (b) return go((p) => (b.dataset.role ? p.set('role', b.dataset.role) : p.delete('role')));
      const cell = e.target.closest('.perk-cell');
      if (cell) { const p = new URLSearchParams(location.hash.split('?')[1] || ''); p.set('p', cell.dataset.id); setHash('perks', p); }
    });
  }
  const input = $('#pq', main);
  if (document.activeElement !== input) input.value = params.get('q') || '';
  $$('.seg button', main).forEach((b) => b.classList.toggle('on', b.dataset.role === role));
  const list = store.perks.filter((p) => (!role || p.role === role) && matchPerk(p, q));
  $('#pcount', main).textContent = list.length;
  $('#pgrid', main).innerHTML = list.map((p) => `<button class="perk-cell no-tip" data-id="${esc(p.id)}" title="${esc(p.name)}">${perkHtml(p)}<span>${esc(p.name)}</span></button>`).join('')
    || '<div class="empty-state" style="grid-column:1/-1"><h3>No such perk</h3><p>Nothing matches that search.</p></div>';
  const open = params.get('p');
  if (open && store.perkById.has(open)) showPerk(store.perkById.get(open));
}

function showPerk(p) {
  const uses = store.builds.filter((b) => b.perks.includes(p.id));
  const tiered = Object.entries(p.tunables || {}).filter(([, v]) => Array.isArray(v) && v.length > 1);
  const html = `<div class="perk-detail">${perkHtml(p)}<div>
      <div class="who" style="font:700 13px var(--cond);letter-spacing:.16em;text-transform:uppercase;color:#b79bd0">${esc(perkOwner(p))}${p.teachable ? ` · teachable at level ${p.teachable}` : ''}</div>
      <h2 style="font-size:32px;color:#fff;margin:4px 0">${esc(p.name)}</h2>${akaHtml(p)}
      <div class="desc" style="font-size:15px;margin-top:12px">${perkDescHtml(p)}</div>
      ${tiered.length ? `<table class="tier-table"><tr><th>Value</th><th>Tier I</th><th>Tier II</th><th>Tier III</th></tr>${tiered.map(([k, v]) => `<tr><td>${esc(k)}</td>${[0, 1, 2].map((i) => `<td>${esc(fmt(v[Math.min(i, v.length - 1)]))}</td>`).join('')}</tr>`).join('')}</table>` : ''}
      <div class="row" style="margin-top:16px">
        <a class="btn small" href="#/builds?q=${encodeURIComponent(p.name)}">${uses.length} build${uses.length === 1 ? '' : 's'} use this</a>
        <a class="btn small ghost" href="#/lab?p=${encodeURIComponent(p.id)}">Start a build with it</a>
        <a class="btn small ghost" href="${esc(p.wiki)}" target="_blank" rel="noopener noreferrer">Wiki page</a>
      </div></div></div>`;
  openModal(html, { cls: p.role, label: p.name, onClose: () => { const q = new URLSearchParams(location.hash.split('?')[1] || ''); q.delete('p'); setHash('perks', q, true); } });
}

// --------------------------------------------------------------- Build Lab
const lab = { role: 'killer', perks: [null, null, null, null], killer: '', video: '', title: '', q: '' };

function labFromParams(params) {
  const ids = (params.get('p') || '').split(',').filter((id) => store.perkById.has(id)).slice(0, 4);
  if (ids.length) {
    lab.role = store.perkById.get(ids[0]).role;
    lab.perks = [0, 1, 2, 3].map((i) => (ids[i] && store.perkById.get(ids[i]).role === lab.role ? ids[i] : null));
  }
  if (params.get('k') && store.killerById.has(params.get('k'))) lab.killer = params.get('k');
  if (params.get('v') && VIDEO_ID.test(params.get('v'))) lab.video = params.get('v');
  if (params.get('t')) lab.title = params.get('t').slice(0, 120);
}
function labParams() {
  const p = new URLSearchParams();
  const ids = lab.perks.filter(Boolean);
  if (ids.length) p.set('p', ids.join(','));
  if (lab.killer && lab.role === 'killer') p.set('k', lab.killer);
  if (lab.video) p.set('v', lab.video);
  if (lab.title) p.set('t', lab.title);
  return p;
}
function videoIdFrom(text) {
  const s = String(text || '').trim();
  if (VIDEO_ID.test(s)) return s;
  const m = /(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/.exec(s);
  return m ? m[1] : '';
}

export function renderLab(main, params, fresh) {
  if (fresh) labFromParams(params);
  main.innerHTML = `<div class="page-head"><h1>Build Lab</h1><p>Put any four perks together and see what the game really gives you: diminishing returns are worked out live from the current patch values. Saved builds stay in this browser — nothing is uploaded.</p></div>
    <div class="lab">
      <aside class="lab-slots">
        ${roleSeg(lab.role).replace('<button data-role="" class="">All</button>', '').replace('<button data-role="" class="on">All</button>', '')}
        <div id="lab-loadout"></div><div class="lab-names" id="lab-names"></div>
        <label class="field" id="lab-killer-field">Killer (optional)<select id="lab-killer"><option value="">Any killer</option>${store.killers.map((k) => `<option value="${esc(k.id)}">${esc(k.name)}</option>`).join('')}</select></label>
        <label class="field">Build name<input id="lab-title" maxlength="120" placeholder="Name your build"></label>
        <label class="field">YouTube link (optional)<input id="lab-video" placeholder="https://www.youtube.com/watch?v=…"></label>
        <div class="row"><button class="btn small" id="lab-save">Save to My builds</button><button class="btn small ghost" id="lab-share">Copy share link</button><button class="btn small ghost" id="lab-export">Export JSON</button><button class="btn small ghost" id="lab-clear">Clear</button></div>
      </aside>
      <div class="lab-list">
        <div id="lab-dr"></div>
        <label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg><input id="lab-q" type="search" placeholder="Find a perk to add…" autocomplete="off" aria-label="Find a perk"></label>
        <section class="perk-grid" id="lab-grid"></section>
      </div>
    </div>`;
  $('#lab-killer', main).value = lab.killer;
  $('#lab-title', main).value = lab.title;
  $('#lab-video', main).value = lab.video ? `https://www.youtube.com/watch?v=${lab.video}` : '';
  $('#lab-q', main).value = lab.q;

  const sync = () => history.replaceState(null, '', `#/lab${labParams().toString() ? `?${labParams()}` : ''}`);
  const draw = () => {
    $$('.lab-slots .seg button', main).forEach((b) => b.classList.toggle('on', b.dataset.role === lab.role));
    $('#lab-killer-field', main).hidden = lab.role !== 'killer';
    $('#lab-loadout', main).innerHTML = loadoutHtml(lab.perks, { tag: 'button', attrsFor: (i, p) => `data-slot="${i}" aria-label="${p ? `Remove ${esc(p.name)}` : 'Empty perk slot'}"` });
    const ps = lab.perks.map((id) => (id ? store.perkById.get(id) : null));
    $('#lab-names', main).innerHTML = ps.map((p, i) => (p ? `<div><span>${esc(p.name)}</span><button data-slot="${i}" aria-label="Remove ${esc(p.name)}">×</button></div>` : '')).join('');
    const picked = ps.filter(Boolean);
    const k = lab.role === 'killer' && lab.killer ? store.killerById.get(lab.killer) : null;
    if (picked.length >= 2) {
      const dr = analyseBuild(picked, store.rules, { role: lab.role, killer: k });
      const tags = picked.length === 4 ? deriveTags({ title: lab.title, role: lab.role, categories: [], tags: [] }, picked) : [];
      $('#lab-dr', main).innerHTML = `${drPanelHtml(dr)}${tags.length ? `<div class="chips" style="margin-top:10px"><span class="chip-label">Auto tags</span>${tags.map((t) => `<span class="chip">${esc(tagLabel(t))}</span>`).join('')}</div>` : ''}`;
    } else {
      $('#lab-dr', main).innerHTML = '<div class="panel"><h3>Pick at least two perks</h3><p class="muted">Diminishing returns only matter once two perks change the same thing. Add perks below and this panel updates as you go.</p></div>';
    }
    const q = lab.q.toLowerCase().trim();
    const list = store.perks.filter((p) => p.role === lab.role && !lab.perks.includes(p.id) && matchPerk(p, q));
    $('#lab-grid', main).innerHTML = list.map((p) => `<button class="perk-cell" data-add="${esc(p.id)}" title="Add ${esc(p.name)}">${perkHtml(p)}<span>${esc(p.name)}</span></button>`).join('') || '<p class="muted">No perk matches.</p>';
    sync();
  };

  main.onclick = async (e) => {
    const roleBtn = e.target.closest('.lab-slots .seg button');
    if (roleBtn) { if (roleBtn.dataset.role !== lab.role) { lab.role = roleBtn.dataset.role; lab.perks = [null, null, null, null]; } return draw(); }
    const slot = e.target.closest('[data-slot]');
    if (slot) { lab.perks[Number(slot.dataset.slot)] = null; return draw(); }
    const add = e.target.closest('[data-add]');
    if (add) {
      const i = lab.perks.indexOf(null);
      if (i < 0) return toast('All four slots are full — remove a perk first');
      lab.perks[i] = add.dataset.add; return draw();
    }
    const id = e.target.id;
    if (id === 'lab-clear') { lab.perks = [null, null, null, null]; lab.title = ''; lab.video = ''; lab.killer = ''; return renderLab(main, new URLSearchParams(), false); }
    if (id === 'lab-share') { try { await navigator.clipboard.writeText(`${location.origin}${location.pathname}#/lab?${labParams()}`); toast('Share link copied'); } catch { toast('Copy failed'); } return; }
    if (id === 'lab-save' || id === 'lab-export') {
      if (lab.perks.some((x) => !x)) return toast('Pick four perks first');
      const entry = { id: `b${Date.now().toString(36)}`, title: lab.title || 'Untitled build', killer: lab.role === 'killer' ? lab.killer : '', perks: [...lab.perks], video: lab.video, created: new Date().toISOString() };
      if (id === 'lab-save') {
        saveMyBuilds([entry, ...loadMyBuilds()]); rebuildBuildList(); toast('Saved to My builds');
        return setHash('builds', new URLSearchParams({ tags: 'mine' }));
      }
      // export in the same shape as data/curated/builds.json, so it can be added to the shared archive
      const k = lab.killer && lab.role === 'killer' ? store.killerById.get(lab.killer) : null;
      const out = { title: entry.title, role: lab.role, killer: k ? k.name : null, perks: lab.perks.map((x) => store.perkById.get(x).name), categories: [], tags: [], summary: '', details: '', tips: [], source: { name: 'My builds', url: lab.video ? `https://www.youtube.com/watch?v=${lab.video}` : null, date: new Date().toISOString().slice(0, 7) }, video: lab.video ? { id: lab.video } : null };
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
      a.download = `${entry.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'build'}.json`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
  };
  $('#lab-q', main).oninput = (e) => { lab.q = e.target.value; draw(); $('#lab-q', main).focus(); };
  $('#lab-killer', main).onchange = (e) => { lab.killer = e.target.value; draw(); };
  $('#lab-title', main).oninput = (e) => { lab.title = e.target.value; sync(); };
  $('#lab-video', main).onchange = (e) => { lab.video = videoIdFrom(e.target.value); if (e.target.value && !lab.video) toast('That does not look like a YouTube link'); sync(); };
  draw();
}

// ------------------------------------------------------------------ Videos
function videoCard(v, found) {
  const date = v.published ? new Date(v.published).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const lp = new URLSearchParams({ v: v.id, t: v.title.slice(0, 100), ...(v.killer?.id ? { k: v.killer.id } : {}) });
  return `<div class="vcard"><a class="thumb" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener noreferrer"><img src="https://i.ytimg.com/vi/${esc(v.id)}/mqdefault.jpg" alt="" loading="lazy">${found ? '<span class="badge mine">Extension</span>' : ''}</a>
    <div class="vb"><h3>${esc(v.title)}</h3><div class="meta"><span>${esc(v.channel || '')}</span><span>${esc(date)}</span>${v.killer ? `<span>${esc(v.killer.name)}</span>` : ''}</div>
    <div class="row"><a class="btn small" href="#/lab?${lp}">Make this a build</a><a class="btn small ghost" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener noreferrer">Watch</a></div></div></div>`;
}
export function renderVideos(main) {
  const seen = new Set();
  const ext = store.ext.videos.filter((v) => !seen.has(v.id) && seen.add(v.id)).map((v) => ({ ...v, title: String(v.title || ''), channel: String(v.channel || ''), killer: null, found: true }));
  const api = store.videos.filter((v) => !seen.has(v.id) && seen.add(v.id));
  const all = [...ext, ...api].sort((a, b) => String(b.published || '').localeCompare(String(a.published || '')));
  main.innerHTML = `<div class="page-head"><h1>Fresh from the fog</h1><p>Recent build videos from vetted Dead by Daylight creators. ${store.ext.connected ? `The browser extension is linked${store.ext.settings?.lastCheck ? ` and last checked ${esc(timeAgo(store.ext.settings.lastCheck))}` : ''}.` : 'Install the companion extension to watch your own list of channels and check on demand.'}</p>
      ${store.ext.connected ? '<div class="row" style="margin-top:10px"><button class="btn small" id="ext-check">Check channels now</button></div>' : ''}</div>
    <section class="vgrid">${all.map((v) => videoCard(v, v.found)).join('') || '<div class="empty-state" style="grid-column:1/-1"><h3>No videos yet</h3><p>The next sync will look again.</p></div>'}</section>`;
  $('#ext-check', main)?.addEventListener('click', () => { askExtension('check-now'); toast('Asking the extension to check your channels…'); });
}

// ----------------------------------------------------------------- Changes
export function renderChanges(main) {
  const entries = store.changelog.entries || [];
  const row = (e) => {
    const p = store.perkById.get(e.perk);
    let body = '';
    if (e.type === 'added') body = '<span class="to">New perk</span>';
    else if (e.type === 'removed') body = '<span class="from">Removed from the game data</span>';
    else body = (e.changes || []).map((c) => (c.what === 'value'
      ? `<div><code>${esc(c.key)}</code> <span class="from">${esc((c.from || []).join(' / '))}</span> → <span class="to">${esc((c.to || []).join(' / '))}</span></div>`
      : c.what === 'name' ? `<div>Renamed <span class="from">${esc(c.from)}</span> → <span class="to">${esc(c.to)}</span></div>`
      : `<div class="muted">Text changed: ${esc(c.to || '')}</div>`)).join('');
    const uses = store.builds.filter((b) => b.perks.includes(e.perk)).length;
    return `<div class="change">${p ? perkHtml(p) : '<span class="perk empty"></span>'}<div><h3 style="font-size:17px;color:#fff">${esc(e.name)} <small class="muted" style="font:500 12px var(--cond);letter-spacing:.1em">${esc(e.date)} · patch ${esc(e.version || '?')}</small></h3>${body}${uses ? `<a class="linkish" href="#/builds?q=${encodeURIComponent(e.name)}">${uses} build${uses === 1 ? '' : 's'} affected</a>` : ''}</div></div>`;
  };
  main.innerHTML = `<div class="page-head"><h1>What changed</h1><p>Every sync compares the live game data with the last one. When a patch changes a perk's numbers or text it is logged here, the builds using it are flagged, and their diminishing returns are recalculated automatically.</p></div>
    <div class="panel">${entries.length ? entries.map(row).join('') : `<h3>No perk changes detected yet</h3><p class="muted">Tracking started with patch ${esc(store.meta.gameVersion || '?')}. The next balance patch will show up here.</p>`}</div>`;
}

// ----------------------------------------------------------------- Sources
export function renderSources(main) {
  const m = store.meta;
  const srcs = (m.sources || []).map((s) => `<div class="panel"><h3>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>` : esc(s.name)} <span class="state ${esc(s.status)}">${esc(s.status)}</span></h3><p>${esc(s.provides || '')}</p><p class="muted">${s.items != null ? `${s.items} items` : ''}${s.detail ? ` · ${esc(s.detail)}` : ''}</p></div>`).join('');
  const bySource = {};
  for (const b of store.builds) bySource[b.source?.name || 'Unknown'] = (bySource[b.source?.name || 'Unknown'] || 0) + 1;
  const dr = store.rules.dr;
  const rules = (store.rules.rules || []).map((r) => `<details class="panel"><summary><b>${esc(r.title)}</b> <span class="state ${r.confidence === 'high' ? 'ok' : 'partial'}">${esc(r.confidence)} confidence</span></summary>
      <p>${esc(r.detail || r.rule)}</p>${r.caveats ? `<p class="muted">Caveats: ${esc(r.caveats)}</p>` : ''}
      ${(r.sources || []).map((s) => `<div class="quote">“${esc(s.quote)}” — <a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(new URL(s.url).hostname)}</a></div>`).join('')}</details>`).join('');
  main.innerHTML = `<div class="page-head"><h1>Sources &amp; sync</h1><p>Game data is for patch <b>${esc(m.gameVersion || '?')}</b>, last checked ${esc(timeAgo(m.checkedAt))} (${esc(new Date(m.checkedAt).toLocaleString())}). The archive re-reads every source on a schedule and rebuilds itself; nothing here is typed in by hand except the curated build write-ups.</p></div>
    <div class="src-grid">${srcs}</div>
    <div class="page-head"><h1>Where builds come from</h1></div>
    <div class="panel"><div class="chips">${Object.entries(bySource).sort((a, b) => b[1] - a[1]).map(([n, c]) => `<span class="chip">${esc(n)}<i>${c}</i></span>`).join('')}</div></div>
    <div class="page-head" style="margin-top:26px"><h1>How diminishing returns are worked out</h1>
      <p>${dr ? `Patch ${esc(dr.introducedIn)} added a global rule: repeated modifiers of the same kind are ranked strongest-first and applied at ${dr.steps.map((s) => `${fmt(s * 100)}%`).join(' / ')}. It covers ${esc((dr.includes || []).join(', '))}; ${esc((dr.excludes || []).join(', '))} are exempt. ` : ''}Bonuses are added together, penalties are multiplied, and a perk's numbers are read from the live game data at each sync. Rules were last checked against patch ${esc(store.rules.patchChecked || '?')} on ${esc(store.rules.checkedOn || '?')}.</p></div>
    ${rules}
    <div class="page-head" style="margin-top:26px"><h1>The API</h1><p>Everything shown here is served as plain JSON that other tools can read:</p></div>
    <div class="panel">${['meta', 'builds', 'perks', 'characters', 'tags', 'videos', 'changelog', 'rules'].map((n) => `<p><a href="api/v1/${n}.json" target="_blank" rel="noopener"><code>api/v1/${n}.json</code></a></p>`).join('')}</div>`;
}
