// Source: the official Dead by Daylight wiki (deadbydaylight.wiki.gg).
// Used for perk icons, killer portraits and perk renames.
//
// The wiki's robots.txt disallows /api.php and /index.php for bots, so this
// module only touches paths it allows: image files under /images/ and article
// pages under /wiki/.

import { fetchBuffer, fetchText } from '../lib/http.mjs';

const BASE = 'https://deadbydaylight.wiki.gg';

export const info = {
  id: 'wiki',
  name: 'Dead by Daylight Wiki',
  url: `${BASE}/`,
  provides: 'Perk icons, killer portraits, perk renames and the stacking rules',
};

const enc = (f) => encodeURIComponent(f.replace(/ /g, '_'));
export const imageUrl = (file) => `${BASE}/images/${enc(file)}`;
export const thumbUrl = (file, width) => `${BASE}/images/thumb/${enc(file)}/${width}px-${enc(file)}`;
export const perkPageUrl = (name) => `${BASE}/wiki/${enc(name)}`;

/** Download a PNG; returns a Buffer or null (404 / not an image). */
export async function fetchPng(url) {
  try {
    const buf = await fetchBuffer(url, { retries: 1 });
    return buf.length > 100 && buf.readUInt32BE(0) === 0x89504e47 ? buf : null;
  } catch {
    return null;
  }
}

/** Candidate icon files for a perk, from the game's asset name ("iconPerks_surge" -> "IconPerks_surge.png"). */
export function perkIconFiles(imageFile) {
  if (!imageFile) return [];
  const base = imageFile.replace(/\.png$/i, '').replace(/^T_UI_/i, '');
  const cap = base.charAt(0).toUpperCase() + base.slice(1);
  return [...new Set([`${cap}.png`, `${cap.replace(/^IconsPerks/i, 'IconPerks')}.png`, `${cap.replace(/^IconPerks/i, 'IconsPerks')}.png`])];
}

/** Turn a full-size wiki image URL into a thumbnail URL (keeps the repo small). */
export function toThumb(url, width = 192) {
  const m = /^https:\/\/deadbydaylight\.wiki\.gg\/images\/([^/?#]+)/.exec(url || '');
  return m ? `${BASE}/images/thumb/${m[1]}/${width}px-${m[1]}` : null;
}

/**
 * Other names a perk goes by. Renamed (licensed) perks show their page title as
 * "New Name (Old Name)", and an old name serves the new page.
 */
export async function perkNames(title) {
  try {
    const html = await fetchText(perkPageUrl(title), { retries: 1 });
    const t = /<title>([^<]+)<\/title>/.exec(html)?.[1] || '';
    const name = t.replace(/\s+-\s+(Official\s+)?Dead by Daylight Wiki\s*$/i, '').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").trim();
    if (!name) return [];
    const m = /^(.*?)\s*\((.+)\)\s*$/.exec(name);
    return m ? [m[1].trim(), m[2].trim()] : [name];
  } catch {
    return [];
  }
}
