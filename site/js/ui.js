// Shared UI pieces: perk diamonds, loadout cluster, tooltip, modal, DR panel.

import { escapeHtml as esc, renderDescription, formatNumber as fmt } from './engine/text.mjs';

export { esc, fmt };

export const store = {
  meta: null, perks: [], perkById: new Map(), characters: [], killers: [], killerById: new Map(),
  builds: [], buildById: new Map(), tags: [], videos: [], changelog: { entries: [] }, rules: { rules: [] },
  ext: { connected: false, videos: [], builds: [] },
};

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const TICKS = '<svg class="ticks" viewBox="0 0 22 16" aria-hidden="true"><path d="M3 14 6 2M10 14 13 2M17 14 20 2" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';

/** One perk, drawn the way the game draws it: white art on a purple diamond with tier marks. */
export function perkHtml(perk, { cls = '', tag = 'span', attrs = '' } = {}) {
  if (!perk) return `<${tag} class="perk empty ${cls}" ${attrs}></${tag}>`;
  const art = perk.icon
    ? `<img src="${esc(perk.icon)}" alt="${esc(perk.name)}" loading="lazy" decoding="async" width="256" height="256">`
    : `<span class="glyph" aria-label="${esc(perk.name)}">${esc(perk.name.replace(/^(Hex|Boon|Scourge Hook|Teamwork|Invocation): /, '').slice(0, 2))}</span>`;
  return `<${tag} class="perk ${cls}" data-perk="${esc(perk.id)}" ${attrs}>${art}${TICKS}</${tag}>`;
}

const POSITIONS = ['top', 'left', 'right', 'bottom'];

/** The four-perk cluster as it appears on the in-trial HUD. */
export function loadoutHtml(perkIds, { layout = null, tag = 'span', size = null, attrsFor = null } = {}) {
  const cells = [0, 1, 2, 3].map((i) => {
    const pos = layout?.[i] && POSITIONS.includes(layout[i]) ? layout[i] : POSITIONS[i];
    const perk = perkIds[i] ? store.perkById.get(perkIds[i]) : null;
    return perkHtml(perk, { cls: `pos-${pos}`, tag, attrs: attrsFor ? attrsFor(i, perk) : '' });
  });
  return `<div class="loadout"${size ? ` style="--w:${Number(size)}px"` : ''}>${cells.join('')}</div>`;
}

export function perkDescHtml(perk) {
  const d = renderDescription(perk, { tier: 3, mode: 'html' });
  let html = d.value;
  if (d.unresolved && perk.wikiText) {
    html += `<span class="wiki-note"><b>Wiki wording (a value is missing from the game data):</b>\n${esc(perk.wikiText)}</span>`;
  }
  return html;
}

export function perkOwner(perk) {
  if (perk.character) return `${perk.character.name} perk`;
  return `General ${perk.role} perk`;
}

export function akaHtml(perk) {
  return perk.altNames?.length ? `<span class="aka">also called ${perk.altNames.map(esc).join(', ')}</span>` : '';
}

// ---------------------------------------------------------------- tooltip
const tip = () => $('#tooltip');
let tipFor = null;
export function initTooltips() {
  const show = (el, x, y) => {
    const perk = store.perkById.get(el.dataset.perk);
    if (!perk) return;
    const t = tip();
    if (tipFor !== el) {
      tipFor = el;
      t.innerHTML = `<h4>${esc(perk.name)}</h4><div class="sub">${esc(perkOwner(perk))}${perk.altNames?.length ? ` · aka ${perk.altNames.map(esc).join(', ')}` : ''}</div><div class="desc">${perkDescHtml(perk)}</div>`;
      t.hidden = false;
    }
    const r = t.getBoundingClientRect();
    let left = x + 18, top = y + 18;
    if (left + r.width > innerWidth - 8) left = Math.max(8, x - r.width - 18);
    if (top + r.height > innerHeight - 8) top = Math.max(8, innerHeight - r.height - 8);
    t.style.left = `${left}px`;
    t.style.top = `${top}px`;
  };
  const hide = () => { tipFor = null; tip().hidden = true; };
  document.addEventListener('mousemove', (e) => {
    const el = e.target.closest?.('[data-perk]');
    if (el && !el.closest('.no-tip')) show(el, e.clientX, e.clientY); else if (tipFor) hide();
  }, { passive: true });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest?.('[data-perk]');
    if (el && !el.closest('.no-tip')) { const r = el.getBoundingClientRect(); show(el, r.right, r.top); }
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('scroll', hide, { passive: true, capture: true });
  document.addEventListener('touchstart', hide, { passive: true });
}

// ------------------------------------------------------------------ modal
let modalState = null;
export function openModal(html, { cls = '', onClose = null, label = 'Details' } = {}) {
  closeModal(true);
  const root = $('#modal-root');
  const prevFocus = document.activeElement;
  root.innerHTML = `<div class="modal-back" role="dialog" aria-modal="true" aria-label="${esc(label)}"><div class="modal ${cls}"><button class="modal-close" aria-label="Close">×</button>${html}</div></div>`;
  const back = root.firstElementChild;
  document.body.classList.add('grasp');
  document.documentElement.style.overflow = 'hidden';
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
    if (e.key === 'Tab') {
      const f = $$('button, a[href], input, select, [tabindex]:not([tabindex="-1"])', back).filter((n) => !n.disabled && n.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  back.addEventListener('mousedown', (e) => { if (e.target === back) closeModal(); });
  $('.modal-close', back).addEventListener('click', () => closeModal());
  document.addEventListener('keydown', onKey);
  modalState = { onClose, onKey, prevFocus };
  $('.modal-close', back).focus({ preventScroll: true });
  return $('.modal', back);
}
export function closeModal(silent = false) {
  if (!modalState) return;
  const { onClose, onKey, prevFocus } = modalState;
  modalState = null;
  document.removeEventListener('keydown', onKey);
  $('#modal-root').innerHTML = '';
  document.body.classList.remove('grasp');
  document.documentElement.style.overflow = '';
  if (!silent) { prevFocus?.focus?.({ preventScroll: true }); onClose?.(); }
}
export const modalOpen = () => !!modalState;

let toastTimer;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ------------------------------------------------- diminishing returns UI
const pct = (n) => `${fmt(Math.round(n * 100) / 100)}%`;
const sign = (g) => (g.positive ? '+' : '−');

export function drBadge(dr) {
  if (!dr) return '';
  if (dr.status === 'active') {
    const g = dr.groups[0];
    return `<span class="badge dr" title="${esc(dr.headline)}">DR · ${esc(g.title)} ${sign(g)}${pct(g.paper)}→${sign(g)}${pct(g.actual)}</span>`;
  }
  return '<span class="badge dr-none" title="No repeated modifiers: every perk applies at full value">DR · none</span>';
}

export function drPanelHtml(dr) {
  if (!dr) return '';
  const steps = (dr.steps || []).map((s, i) => `<i title="${i + 1}${['st', 'nd', 'rd'][i] || 'th'} strongest">${fmt(s * 100)}%</i>`).join('');
  let h = `<div class="dr ${dr.status}"><div class="dr-head"><i class="lamp"></i>${dr.status === 'active' ? 'Diminishing returns apply' : 'No diminishing returns'}</div>`;

  for (const g of dr.groups) {
    const max = Math.max(g.paper, 0.0001);
    h += `<div class="dr-group"><h5>${esc(g.title)} <small>on ${esc(g.on)} · while these are active together${g.unconfirmed ? ' · ranking not confirmed by BHVR' : ''}</small></h5>`;
    for (const e of g.entries) {
      const p = store.perkById.get(e.perk);
      h += `<div class="dr-row"><span class="rank"><b>${e.rank}</b></span><span class="nm" ${p ? `data-perk="${esc(p.id)}"` : ''}>${esc(e.name)}${e.stacks > 1 ? ` <small>${fmt(e.per)}% × ${e.stacks} ${esc(e.unit || '')}</small>` : ''}</span><span class="base">${sign(g)}${pct(e.value)}</span><span class="factor ${e.factor < 1 ? 'cut' : ''}">× ${fmt(e.factor * 100)}%</span><span class="eff">${sign(g)}${pct(e.effective)}</span></div>`;
    }
    h += `<div class="dr-bar" title="Solid: what you get. Hatched: lost to diminishing returns."><i style="width:${(g.actual / max) * 100}%"></i><i class="lost" style="width:${(g.lost / max) * 100}%"></i></div>`;
    h += `<div class="dr-total"><span>On paper <b>${sign(g)}${pct(g.paper)}</b></span><span>In a trial <b>${sign(g)}${pct(g.actual)}</b></span><span class="lost">${pct(g.lost)} lost</span>`;
    if (g.example) {
      const u = g.example.unit || 's';
      h += `<span>${esc(g.example.what)}: ${fmt(g.example.base)} ${u} → <b>${fmt(g.example.actual)} ${u}</b> <span class="muted">(not ${fmt(g.example.paper)} ${u})</span></span>`;
    }
    h += '</div></div>';
  }

  if (dr.singles?.length) {
    h += `<div class="dr-group"><h5>Single modifiers <small>full value — a second source of the same kind would count at ${fmt((dr.steps?.[1] ?? 0.5) * 100)}%</small></h5>`;
    for (const s of dr.singles) {
      const ex = s.example ? ` <small>${fmt(s.example.base)} → ${fmt(s.example.actual)} ${esc(s.example.unit || '')}</small>` : '';
      h += `<div class="dr-single"><b>${sign(s)}${pct(s.value)}</b><span>${esc(s.title)} <small>on ${esc(s.on)} · ${esc(s.name)}${s.stacks > 1 ? ` at ${s.stacks} ${esc(s.unitOf || 'stacks')}` : ''}</small>${ex}</span></div>`;
    }
    h += '</div>';
  }

  if (dr.regression) {
    const r = dr.regression;
    h += `<div class="dr-group"><h5>Instant generator regression <small>each explosion is its own event${r.generatorCharges ? `, measured against the whole generator (${r.generatorCharges} charges)` : ''}</small></h5>`;
    for (const it of r.items) {
      const sec = r.generatorCharges ? ` <small>≈ ${fmt(Math.round(it.value * r.generatorCharges) / 100)} s of repair</small>` : '';
      h += `<div class="dr-single"><b>−${pct(it.value)}</b><span>${esc(it.name)} <small>${it.onKick ? `added to the kick${r.kickPct ? ` (${r.kickPct}% base)` : ''}` : it.multi ? 'every generator in range' : 'one generator'}${it.stacks > 1 ? ` · ${it.stacks} Tokens` : ''}</small>${sec}</span></div>`;
    }
    h += '</div>';
  }

  for (const n of dr.notes || []) {
    h += `<div class="dr-note"><b>${esc(n.title)}</b>${esc(n.text)}${n.source ? ` <a href="${esc(n.source)}" target="_blank" rel="noopener noreferrer">source</a>` : ''}</div>`;
  }
  h += `<div class="dr-foot">Since patch 9.6.0 repeated modifiers of the same kind are ranked strongest-first: <span class="steps">${steps}</span>. This ranks the build's perks; in a trial, items, powers and offerings join the same ranking and add-ons are exempt. <a href="#/sources">How this is worked out</a></div></div>`;
  return h;
}

export const CLAW = (cls) => `<i class="claw ${cls}" aria-hidden="true"></i>`;

export function timeAgo(iso) {
  if (!iso) return 'unknown';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400 * 1.5) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
