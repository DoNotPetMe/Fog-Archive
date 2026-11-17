// Tagging: every build gets tags derived from what its perks actually do
// (read from live perk data), merged with tags supplied by its source.
// Shared by the sync pipeline, the site and the browser extension.

import { slugify } from './text.mjs';

/** Tag catalogue: id -> label + group (used for filter chips and colours). */
export const TAGS = {
  // categories (the big four the archive is organised around)
  meta: { label: 'Meta', group: 'category' },
  toxic: { label: 'Toxic', group: 'category' },
  fun: { label: 'Fun', group: 'category' },
  recommended: { label: 'Recommended', group: 'category' },
  beginner: { label: 'Beginner friendly', group: 'category' },
  creator: { label: 'Creator build', group: 'category' },
  'multi-build': { label: 'Multi-build video', group: 'category' },
  // killer playstyles
  'gen-regression': { label: 'Gen regression', group: 'style' },
  'gen-block': { label: 'Gen blocking', group: 'style' },
  'gen-kick': { label: 'Gen kicking', group: 'style' },
  slowdown: { label: 'Slowdown', group: 'style' },
  'anti-heal': { label: 'Anti-heal', group: 'style' },
  slugging: { label: 'Slugging', group: 'style' },
  tunnelling: { label: 'Tunnelling', group: 'style' },
  camping: { label: 'Camping', group: 'style' },
  endgame: { label: 'Endgame', group: 'style' },
  instadown: { label: 'Instadown', group: 'style' },
  stealth: { label: 'Stealth', group: 'style' },
  chase: { label: 'Chase', group: 'style' },
  aura: { label: 'Aura reading', group: 'style' },
  info: { label: 'Information', group: 'style' },
  basement: { label: 'Basement', group: 'style' },
  // survivor playstyles
  'gen-rush': { label: 'Gen rush', group: 'style' },
  healing: { label: 'Healing', group: 'style' },
  'anti-slug': { label: 'Anti-slug', group: 'style' },
  'anti-tunnel': { label: 'Anti-tunnel', group: 'style' },
  bully: { label: 'Bully squad', group: 'style' },
  flashlight: { label: 'Flashlight / blind', group: 'style' },
  sabotage: { label: 'Sabotage', group: 'style' },
  wiggle: { label: 'Wiggle', group: 'style' },
  stun: { label: 'Stuns', group: 'style' },
  locker: { label: 'Lockers', group: 'style' },
  chests: { label: 'Chests & items', group: 'style' },
  totems: { label: 'Totems', group: 'style' },
  altruism: { label: 'Altruism', group: 'style' },
  solo: { label: 'Solo queue', group: 'style' },
  team: { label: 'Team / SWF', group: 'style' },
  meme: { label: 'Meme', group: 'style' },
  // mechanics
  hex: { label: 'Hex', group: 'mechanic' },
  'full-hex': { label: 'Full Hex', group: 'mechanic' },
  'scourge-hook': { label: 'Scourge Hook', group: 'mechanic' },
  boon: { label: 'Boon', group: 'mechanic' },
  exhaustion: { label: 'Exhaustion', group: 'mechanic' },
  haste: { label: 'Haste', group: 'mechanic' },
  hindered: { label: 'Hindered', group: 'mechanic' },
  exposed: { label: 'Exposed', group: 'mechanic' },
  endurance: { label: 'Endurance', group: 'mechanic' },
  obsession: { label: 'Obsession', group: 'mechanic' },
  tokens: { label: 'Tokens', group: 'mechanic' },
  scream: { label: 'Screams', group: 'mechanic' },
  vault: { label: 'Vaulting', group: 'mechanic' },
  'skill-checks': { label: 'Skill checks', group: 'mechanic' },
  'diminishing-returns': { label: 'Diminishing returns', group: 'mechanic' },
  video: { label: 'Has video', group: 'meta' },
};

export function tagLabel(id) {
  if (TAGS[id]) return TAGS[id].label;
  return id.replace(/-/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export function tagGroup(id) {
  return TAGS[id]?.group || (id.startsWith('killer:') ? 'killer' : id.startsWith('source:') ? 'source' : 'other');
}

const SYNONYMS = {
  'gen-slowdown': 'slowdown', regression: 'gen-regression', 'generator-regression': 'gen-regression', 'gen-damage': 'gen-kick',
  slug: 'slugging', 'bleed-out': 'slugging', tunnel: 'tunnelling', tunneling: 'tunnelling', camp: 'camping', 'face-camp': 'camping',
  'end-game': 'endgame', egc: 'endgame', noed: 'endgame', 'insta-down': 'instadown', 'one-shot': 'instadown',
  auras: 'aura', 'aura-reading': 'aura', information: 'info', tracking: 'info', 'gen-speed': 'gen-rush', genrush: 'gen-rush',
  heal: 'healing', heals: 'healing', 'anti-healing': 'anti-heal', flashlights: 'flashlight', blind: 'flashlight', blinds: 'flashlight',
  'bully-squad': 'bully', sabo: 'sabotage', stuns: 'stun', 'pallet-stun': 'stun', lockers: 'locker', 'head-on': 'locker',
  chest: 'chests', items: 'chests', totem: 'totems', hexes: 'hex', 'scourge-hooks': 'scourge-hook', scourge: 'scourge-hook', boons: 'boon',
  screams: 'scream', vaulting: 'vault', 'vault-speed': 'vault', 'skill-check': 'skill-checks', skillcheck: 'skill-checks',
  'solo-queue': 'solo', soloq: 'solo', swf: 'team', memes: 'meme', funny: 'meme', 'beginner-friendly': 'beginner', starter: 'beginner',
  speed: 'haste', 'movement-speed': 'haste', oppressive: 'toxic', 'anti-tunnelling': 'anti-tunnel', 'anti-tunneling': 'anti-tunnel',
  'anti-slugging': 'anti-slug', unbreakable: 'anti-slug', 'exposed-status': 'exposed', '3-gen': 'gen-regression', 'three-gen': 'gen-regression',
};

export function canonicalTag(raw) {
  const s = slugify(raw);
  return SYNONYMS[s] || s;
}

const TITLE_HINTS = [
  [/beginner|starter|simple|easy|accessible|noob|super simple/i, 'beginner'],
  [/\bhex\b/i, 'hex'],
  [/scourge/i, 'scourge-hook'],
  [/boon/i, 'boon'],
  [/endgame|end-game/i, 'endgame'],
  [/stealth|ambush|disappear/i, 'stealth'],
  [/aura/i, 'aura'],
  [/\binfo\b|surveillance|tracking|radar|reveal/i, 'info'],
  [/instadown|insta-down|starstruck|exposed/i, 'instadown'],
  [/gen[- ]kick|gen damage|breaking speed/i, 'gen-kick'],
  [/slowdown|stall|regression|gen[- ]control|gen[- ]focused|ruin|compromised/i, 'slowdown'],
  [/chase|pallet|m1 cooldown|flow/i, 'chase'],
  [/obsession/i, 'obsession'],
  [/chest/i, 'chests'],
  [/gen rush|gen-jockey|gen jockey/i, 'gen-rush'],
  [/heal/i, 'healing'],
  [/slug/i, 'anti-slug'],
  [/tunnel/i, 'anti-tunnel'],
  [/basement/i, 'basement'],
  [/locker/i, 'locker'],
  [/unhook|team|helper|support/i, 'altruism'],
  [/solo/i, 'solo'],
  [/meme|fun\b|troll|scream/i, 'meme'],
];

/**
 * Derive tags for a build.
 *  build: { title, role, killer, categories[], tags[] (source-supplied), video }
 *  perks: the four resolved perk objects (with .fx = extractEffects result)
 */
export function deriveTags(build, perks) {
  const tags = new Set();
  const add = (t) => t && tags.add(t);
  for (const c of build.categories || []) add(canonicalTag(c));
  for (const t of build.tags || []) add(canonicalTag(t));
  for (const [re, tag] of TITLE_HINTS) if (re.test(build.title || '')) add(tag);

  const count = (fn) => perks.filter((p) => p && fn(p)).length;
  const fx = (p) => p.fx?.effects || [];
  const flag = (p, f) => !!p.fx?.flags?.[f];
  const kw = (p, k) => (p.fx?.keywords || []).includes(k);
  const cat = (p, c) => (p.categories || []).includes(c);
  const role = build.role;

  // mechanics: a single perk is enough to matter
  const hexes = count((p) => flag(p, 'hex'));
  if (hexes) add('hex');
  if (hexes >= 3) add('full-hex');
  if (count((p) => flag(p, 'scourge'))) add('scourge-hook');
  if (count((p) => flag(p, 'boon'))) add('boon');
  if (count((p) => fx(p).some((e) => e.kind === 'exhaustion'))) add('exhaustion');
  if (count((p) => kw(p, 'exposed'))) add(role === 'killer' ? 'instadown' : 'exposed');
  if (count((p) => kw(p, 'endurance')) && role === 'survivor') add('endurance');
  if (count((p) => flag(p, 'endgame'))) add('endgame');
  if (count((p) => fx(p).some((e) => e.kind === 'haste' && (e.target === 'self' || e.target === 'self+ally')))) add('haste');
  if (count((p) => fx(p).some((e) => e.kind === 'hindered'))) add('hindered');

  // playstyles: need weight (two perks), or one perk plus nothing else to say
  const two = (fn, tag) => { if (count(fn) >= 2) add(tag); };
  if (role === 'killer') {
    const regress = count((p) => fx(p).some((e) => e.kind === 'regression' || e.kind === 'regression-rate'));
    const block = count((p) => fx(p).some((e) => e.kind === 'gen-block'));
    const slow = count((p) => fx(p).some((e) => e.kind === 'action' && e.sign < 0 && e.target === 'survivors' && e.action === 'repair'));
    if (regress) add('gen-regression');
    if (block) add('gen-block');
    if (regress + block + slow >= 2) add('slowdown');
    two((p) => flag(p, 'genKick'), 'gen-kick');
    if (count((p) => fx(p).some((e) => e.kind === 'action' && e.sign < 0 && e.action === 'heal') || kw(p, 'mangled') || kw(p, 'hemorrhage')) >= 1) add('anti-heal');
    two((p) => kw(p, 'undetectable') || cat(p, 'concealment'), 'stealth');
    two((p) => fx(p).some((e) => e.kind === 'aura' && e.of === 'survivors' && e.who === 'self'), 'aura');
    two((p) => cat(p, 'tracking'), 'info');
    two((p) => cat(p, 'chasing') || fx(p).some((e) => e.kind === 'action' && e.sign > 0 && ['vault', 'break'].includes(e.action)), 'chase');
    two((p) => flag(p, 'obsession'), 'obsession');
    two((p) => flag(p, 'scream'), 'scream');
    two((p) => flag(p, 'basement'), 'basement');
  } else {
    two((p) => fx(p).some((e) => e.kind === 'action' && e.sign > 0 && e.action === 'repair'), 'gen-rush');
    two((p) => fx(p).some((e) => e.kind === 'action' && e.sign > 0 && e.action === 'heal'), 'healing');
    two((p) => fx(p).some((e) => e.kind === 'action' && e.action === 'recover') || /fully recover/.test(p.text || ''), 'anti-slug');
    two((p) => fx(p).some((e) => e.kind === 'aura'), 'aura');
    two((p) => flag(p, 'blind'), 'flashlight');
    two((p) => flag(p, 'wiggle'), 'wiggle');
    two((p) => flag(p, 'stun'), 'stun');
    two((p) => flag(p, 'locker'), 'locker');
    two((p) => flag(p, 'chest'), 'chests');
    two((p) => flag(p, 'totem') && !flag(p, 'boon'), 'totems');
    two((p) => fx(p).some((e) => e.kind === 'action' && e.sign > 0 && e.action === 'vault'), 'vault');
    two((p) => cat(p, 'navigation'), 'chase');
    two((p) => flag(p, 'unhook'), 'altruism');
    two((p) => flag(p, 'obsession'), 'obsession');
    two((p) => flag(p, 'scream'), 'scream');
    two((p) => kw(p, 'elusive') || /scratch marks/.test(p.text || ''), 'stealth');
    if (count((p) => fx(p).some((e) => e.kind === 'action' && e.action === 'sabotage') || /sabotag/.test(p.text || '')) >= 1) add('sabotage');
  }
  two((p) => flag(p, 'skillcheck'), 'skill-checks');

  if (build.video) add('video');
  return [...tags].sort();
}
