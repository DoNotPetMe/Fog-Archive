// Build search + filtering. One implementation, used by the site in the
// browser and by the local API server (server.mjs) for /api/v1/builds?q=...

import { normName } from './text.mjs';

/** Precompute a lowercase haystack per build. perkById: Map(id -> perk). */
export function indexBuilds(builds, perkById) {
  for (const b of builds) {
    const perkNames = b.perks.map((id) => {
      const p = perkById.get(id);
      return p ? [p.name, ...(p.altNames || [])].join(' ') : '';
    });
    b._hay = [
      b.title, b.killer?.name || '', b.role, b.summary || '', b.details || '', (b.tips || []).join(' '),
      perkNames.join(' '), (b.tags || []).join(' '), b.source?.name || '', b.video?.channel || '', b.video?.title || '',
    ].join(' \n ').toLowerCase();
    b._hayNorm = normName(b._hay);
  }
  return builds;
}

/**
 * filters: { q, role, killer (id), category, tags: [], source, video: bool, dr: bool }
 * A build must match every selected tag. Search terms are AND-ed; a term
 * matches literally or with punctuation/accents stripped ("deja vu" finds "Déjà Vu").
 */
export function filterBuilds(builds, filters = {}) {
  const terms = String(filters.q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const tags = (filters.tags || []).filter(Boolean);
  const out = [];
  for (const b of builds) {
    if (filters.role && b.role !== filters.role) continue;
    if (filters.killer && b.killer?.id !== filters.killer) continue;
    if (filters.category && !(b.categories || []).includes(filters.category)) continue;
    if (filters.source && b.source?.id !== filters.source) continue;
    if (filters.video && !b.video) continue;
    if (filters.dr && b.dr?.status !== 'active') continue;
    if (tags.length && !tags.every((t) => b.tags.includes(t))) continue;
    let score = 0;
    let ok = true;
    for (const t of terms) {
      const n = normName(t);
      if (b._hay.includes(t) || (n && b._hayNorm.includes(n))) {
        if (b.title.toLowerCase().includes(t)) score += 3;
        else if ((b.killer?.name || '').toLowerCase().includes(t)) score += 2;
        else score += 1;
      } else { ok = false; break; }
    }
    if (!ok) continue;
    out.push({ b, score });
  }
  if (terms.length) out.sort((x, y) => y.score - x.score);
  return out.map((x) => x.b);
}
