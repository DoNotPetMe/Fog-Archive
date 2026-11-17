// Finds perk builds written in a video's description or title.
//
// Many creators list their loadout as a line such as
//   "Basement Trapper - Agitation, Scourge Hook: Monstrous Shrine, Make Your Choice, Hex: Crowd Control + add-ons"
// A line counts as a build only when it names exactly four different perks of
// the same role, so chatter that merely mentions a perk is ignored.
// Shared by the sync pipeline and the browser extension (extension/lib is a copy).

import { normName } from './text.mjs';

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** perks: [{ id, name, altNames?, role }] -> lookup used by the detectors. */
export function makePerkIndex(perks) {
  const exact = new Map();
  for (const p of perks) {
    for (const n of [p.name, ...(p.altNames || [])]) {
      const k = normName(n);
      if (k && !exact.has(k)) exact.set(k, p);
      // "Hex: Ruin" is often written "Ruin"; "Scourge Hook: Pain Resonance" as "Pain Resonance"
      const short = normName(n.replace(/^(Hex|Boon|Scourge Hook|Teamwork|Invocation):\s*/i, ''));
      if (short && short.length >= 4 && !exact.has(short)) exact.set(short, p);
    }
  }
  return { exact, keys: [...exact.keys()] };
}

export function findPerk(index, raw) {
  const k = normName(raw);
  if (k.length < 3) return null;
  const hit = index.exact.get(k);
  if (hit) return hit;
  if (k.length < 7) return null;
  // typos ("Residiual Manifest"): one or two letters off, and unambiguous
  let best = null, bestD = 3, tie = false;
  for (const key of index.keys) {
    const d = editDistance(k, key);
    if (d < bestD) { best = key; bestD = d; tie = false; } else if (d === bestD && d < 3) tie = true;
  }
  return best && bestD <= 2 && !tie ? index.exact.get(best) : null;
}

/** killers: [{ id, name }] -> the killer a piece of text is about, if exactly one is named. */
export function findKiller(killers, text) {
  const t = ` ${String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const hits = [];
  for (const k of killers) {
    const short = k.name.replace(/^The /i, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (short.length >= 3 && t.includes(` ${short} `)) hits.push(k);
  }
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Returns [{ label, perks: [perk x4], role, killer }] for every build line found.
 * text: a video description (or any text); title: used when a line has no label.
 */
export function extractBuilds(text, index, killers = [], title = '') {
  const out = [];
  const seen = new Set();
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    let line = rawLine.trim().replace(/^[-•*▶►➤\d.)\s]+(?=[A-Za-z])/, '');
    if (line.length < 12 || line.length > 400 || /https?:\/\//i.test(line)) continue;
    // drop the add-on / item tail: "... perk, perk + Iridescent Stone and Trapper Sack"
    line = line.split(/\s\+\s/)[0];
    // optional label: "Basement Trapper - a, b, c, d" / "Game 1: a, b, c, d" (but not "Hex: Ruin")
    let label = '';
    const dash = line.search(/\s[-–—]\s/);
    if (dash > 0 && dash < 60 && !line.slice(0, dash).includes(',')) { label = line.slice(0, dash).trim(); line = line.slice(dash).replace(/^\s[-–—]\s/, ''); }
    else {
      const colon = /^([^,:]{2,40}):\s+(?=.*,)/.exec(line);
      if (colon && !/^(hex|boon|scourge hook|teamwork|invocation)$/i.test(colon[1].trim())) { label = colon[1].trim(); line = line.slice(colon[0].length); }
    }
    // commas / slashes / pipes first; "and" and "&" only split a piece that is not itself a perk ("Barbecue & Chili")
    const tokens = line.split(/\s*(?:,|\s\/\s|\s\|\s)\s*/)
      .flatMap((t) => (findPerk(index, t.replace(/[.!]+$/, '')) ? [t] : t.split(/\s+(?:&|and)\s+/i)))
      .map((s) => s.trim().replace(/[.!]+$/, '')).filter(Boolean);
    if (tokens.length < 4 || tokens.length > 6) continue;
    const perks = [];
    for (const tok of tokens) {
      const p = findPerk(index, tok);
      if (p && !perks.includes(p)) perks.push(p);
    }
    if (perks.length !== 4 || perks.length < tokens.length - 1) continue;
    const role = perks[0].role;
    if (perks.some((p) => p.role !== role)) continue;
    const key = perks.map((p) => p.id).sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const generic = /^(game|match|build|trial|round)\s*#?\d*$/i.test(label) || /^the builds?$/i.test(label);
    const killer = role === 'killer' ? findKiller(killers, label) || (generic || !label ? findKiller(killers, title) : null) : null;
    out.push({ label: generic ? '' : label, part: generic ? label : '', perks, role, killer });
  }
  return out;
}

/** "THE BUILD:" followed by four lines that are each exactly one perk. */
export function extractListBuilds(text, index, killers = [], title = '') {
  const out = [];
  let run = [];
  let header = '';
  const flush = () => {
    if (run.length === 4 && new Set(run).size === 4 && run.every((p) => p.role === run[0].role)) {
      const role = run[0].role;
      out.push({ label: /^(the )?builds?:?$|^perks:?$|^loadout:?$/i.test(header) ? '' : header.replace(/:$/, ''), perks: run, role, killer: role === 'killer' ? findKiller(killers, header) || findKiller(killers, title) : null });
    }
    run = [];
  };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-•*▶►➤\d.)\s]+(?=[A-Za-z])/, '').replace(/[.!]+$/, '');
    const p = line && line.length <= 40 ? findPerk(index, line) : null;
    if (p) { run.push(p); continue; }
    flush();
    if (line) header = line.length <= 60 ? line : '';
  }
  flush();
  return out;
}

/** Four perks named in a video title ("Surge + Coup de Grâce + ... on Legion"). */
export function extractTitleBuild(title, index, killers = []) {
  const parts = String(title || '').replace(/\|\s*dead by daylight.*$/i, '').split(/\s*(?:\+|,|&|\/|\||\band\b|\bwith\b)\s*/i);
  const perks = [];
  for (const part of parts) {
    const p = findPerk(index, part.replace(/\b(?:is|are|build|combo|on|in|dbd|broken|op)\b.*$/i, '').trim());
    if (p && !perks.includes(p)) perks.push(p);
  }
  if (perks.length !== 4 || perks.some((p) => p.role !== perks[0].role)) return null;
  return { label: '', perks, role: perks[0].role, killer: perks[0].role === 'killer' ? findKiller(killers, title) : null };
}

/** The creator's own framing of a video, from its title. Only used as tags/categories. */
export function titleCategories(title) {
  const t = String(title || '').toLowerCase();
  // only the creator's literal word counts: a guessed label would be wrong information
  const out = [];
  if (/\btoxic\b/.test(t)) out.push('toxic');
  if (/\bmeta\b/.test(t)) out.push('meta');
  if (/\bfun\b|\bmeme\b/.test(t)) out.push('fun');
  return out;
}

/** Everything a video says about builds: description lines, perk lists, then the title. */
export function detectVideoBuilds({ title = '', description = '' }, index, killers = []) {
  const found = [];
  const key = (b) => b.perks.map((p) => p.id).sort().join('|');
  const seen = new Set();
  const push = (b, from) => { const k = key(b); if (!seen.has(k)) { seen.add(k); found.push({ ...b, from }); } };
  for (const b of extractBuilds(description, index, killers, title)) push(b, 'description');
  for (const b of extractListBuilds(description, index, killers, title)) push(b, 'description');
  const tb = extractTitleBuild(title, index, killers);
  if (tb) push(tb, 'title');
  return found;
}

/** Keyword test for "is this video about a build?" (title only). */
export function looksLikeBuildVideo(title, keywords = ['build', 'perk', 'combo', 'loadout', 'meta', 'synergy']) {
  const t = String(title || '').toLowerCase();
  return keywords.some((k) => k && new RegExp(`\\b${k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`).test(t));
}
