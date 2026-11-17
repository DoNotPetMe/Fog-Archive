// Source: Otzdarva's builds site (otzdarva-builds.com) — recommended builds
// for every killer plus survivor builds, published as a public JSON file.

import { fetchJson } from '../lib/http.mjs';
import { htmlToText } from '../../site/js/engine/text.mjs';

const BASE = 'https://otzdarva-builds.com';

export const info = {
  id: 'otzdarva',
  name: "Otzdarva's Builds",
  url: 'https://otzdarva-builds.com/',
  provides: 'Recommended builds for every killer, plus survivor builds, with alternates and notes',
};

const cleanNote = (s) => htmlToText(String(s || '')).replace(/\s+/g, ' ').trim();

export async function load() {
  const [data, scrape] = await Promise.all([
    fetchJson(`${BASE}/data/builds.json`),
    fetchJson(`${BASE}/data/scrape.json`).catch(() => null),
  ]);

  const builds = [];
  const push = (role, group, b) => {
    if (!b || !Array.isArray(b.perks) || b.perks.length !== 4) return;
    const title = String(b.name || '').trim();
    if (title.length < 5) return; // placeholder rows
    builds.push({
      source: 'otzdarva',
      sourceUrl: `${BASE}/`,
      title,
      role,
      killer: role === 'killer' && group !== 'Universal Builds' ? group : null,
      group: role === 'survivor' ? group : null,
      perks: b.perks.map((p) => String(p?.name || '').trim()),
      alts: b.perks.map((p) => (Array.isArray(p?.alts) ? p.alts.map((a) => String(a?.name || '').trim()).filter(Boolean) : [])),
      notes: (Array.isArray(b.notes) ? b.notes : []).map(cleanNote).filter(Boolean),
    });
  };
  for (const k of data?.killers || []) for (const b of k.builds || []) push('killer', k.name, b);
  for (const g of data?.survivors || []) for (const b of g.builds || []) push('survivor', g.name, b);

  // The site's own wiki scrape gives a second, independent copy of every perk
  // description (used to cross-check / fill values the game data lacks).
  const wikiPerks = [];
  for (const side of ['killers', 'survivors']) {
    for (const p of scrape?.[side]?.perks || []) {
      if (p?.name) wikiPerks.push({ name: p.name, text: htmlToText(p.description || ''), iconUrl: p.iconUrl || null });
    }
  }
  const portraits = {};
  for (const c of scrape?.killers?.profiles || []) if (c?.name && c.portraitUrl) portraits[c.name] = c.portraitUrl;

  return { builds, wikiPerks, portraits, patch: scrape?.other?.patchNumber || null };
}
