// Source: dbd.tricky.lol — game data extracted from the live build
// (perk text templates, per-tier tunables, characters, current version).

import { fetchJson } from '../lib/http.mjs';

const BASE = 'https://dbd.tricky.lol/api';

export const info = {
  id: 'tricky',
  name: 'dbd.tricky.lol',
  url: 'https://dbd.tricky.lol/',
  provides: 'Perk text, per-tier values, characters and the live game version',
};

export async function load() {
  const [versions, perksRaw, charsRaw] = await Promise.all([
    fetchJson(`${BASE}/versions`),
    fetchJson(`${BASE}/perks`),
    fetchJson(`${BASE}/characters`),
  ]);

  const characters = {};
  for (const [key, c] of Object.entries(charsRaw)) {
    if (!c || !c.name || !c.role) continue;
    const tun = c.tunables || {};
    characters[key] = {
      id: String(c.id || key),
      key,
      name: c.name,
      role: c.role,
      imageFile: String(c.image || '').split('/').pop() || null,
      // 460 -> 4.6 m/s. Only present for killers.
      speed: typeof tun.MaxWalkSpeed === 'number' ? tun.MaxWalkSpeed / 100 : null,
      terrorRadius: typeof tun.TerrorRadius === 'number' ? tun.TerrorRadius / 100 : null,
    };
  }

  const perks = {};
  for (const [id, p] of Object.entries(perksRaw)) {
    if (!p || !p.name || !p.role) continue;
    const ch = p.character === null || p.character === undefined ? null : characters[String(p.character)] || null;
    perks[id] = {
      id,
      name: p.name,
      role: p.role,
      character: ch ? { id: ch.id, name: ch.name } : null,
      categories: Array.isArray(p.categories) ? p.categories : [],
      template: String(p.description || ''),
      tunables: p.tunables && typeof p.tunables === 'object' ? p.tunables : {},
      teachable: p.teachable || 0,
      imageFile: String(p.image || '').split('/').pop() || null,
    };
  }

  return {
    version: versions?.perks?.version || null,
    updated: versions?.perks?.lastupdate ? new Date(versions.perks.lastupdate * 1000).toISOString() : null,
    perks,
    characters,
  };
}
