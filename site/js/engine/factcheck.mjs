// Write-up fact-checker.
//
// Every sentence written about a build (summary, details, tips) is checked
// against the LIVE text of the perks actually in that build:
//
//  1. Cause -> effect claims ("hooks blow up generators") need a perk in the
//     build whose text links that trigger to that effect.
//  2. The perk's conditions must not be dropped: manual activation (ability
//     button), basic-attack only, range limits, line of sight, one generator
//     vs many, "first time only", extra actions (a kick), automatic Token use.
//  3. Status effects named must be applied by a perk in the build (or the
//     sentence must say they come from a power, add-on, item or teammate).
//  4. Every number must be a live value of these perks (or a verified game
//     constant). Write numbers as value tokens: {{Perk Name|tunablekey}}.
//  5. Perks named in the text must be in the build, in its alternatives, or
//     be clearly offered as a swap.
//
// A write-up is shown on the site only when it passes. A curated write-up is
// also stamped with a hash of each perk's text and values when it is
// reviewed; if a patch changes any of those perks the stamp goes stale and the
// write-up is hidden again until it is re-checked.
//
// Shared by the sync pipeline, the CLI (api/tools/factcheck.mjs), the tests and the site.

import { normName, formatNumber } from './text.mjs';

// ------------------------------------------------------------ value tokens
/** Replace {{Perk Name|key}} (tier III) or {{Perk Name|key|all}} (I/II/III) with live values. */
export function fillValues(text, perkByName) {
  const missing = [];
  const out = String(text || '').replace(/\{\{\s*([^|}]+?)\s*\|\s*([^|}]+?)\s*(?:\|\s*(all)\s*)?\}\}/g, (m, name, key, all) => {
    const p = perkByName.get(normName(name));
    const v = p?.tunables?.[key.trim().toLowerCase()];
    if (!Array.isArray(v) || !v.length) { missing.push(`${name}|${key}`); return '?'; }
    return all && v.length > 1 ? v.map(formatNumber).join('/') : formatNumber(v[v.length - 1]);
  });
  return { text: out, missing };
}

export function perkNameIndex(perks) {
  const m = new Map();
  for (const p of perks) for (const n of [p.name, ...(p.altNames || [])]) { const k = normName(n); if (k && !m.has(k)) m.set(k, p); }
  return m;
}

/** Stable hash of a perk's text and values (FNV-1a). Changes whenever a patch touches the perk. */
export function perkHash(p) {
  const s = `${p.template}|${JSON.stringify(p.tunables || {})}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

// --------------------------------------------------------------- lexicons
const norm = (s) => ` ${String(s || '').toLowerCase()
  .replace(/[’‘]/g, "'")
  .replace(/\bgens\b/g, 'generators').replace(/\bgen\b/g, 'generator')
  .replace(/\bm1s?\b/g, 'basic attack').replace(/basic-attack/g, 'basic attack')
  .replace(/\s+/g, ' ')} `;

const TRIGGERS = {
  hook: { label: 'hooking', re: /\bhook(?:s|ed|ing)?\b(?! state)/ },
  down: { label: 'downing a Survivor', re: /(?<!\b(?:slows?|slowing|slowed|shut|shuts|calm|break|breaks|back|up and|upside|low) )\b(?:downs?|downed|downing)\b(?! (?:to|the line|time|side|on))|\bdying state\b/ },
  kick: { label: 'kicking a generator', re: /\bkick(?:s|ed|ing)?\b|\bdamag(?:e|es|ed|ing) (?:a |the |that )?generators?\b/ },
  complete: { label: 'a generator being completed', re: /\b(?:complet(?:e|ed|es|ing)|finish(?:ed|es|ing)?|pop(?:s|ped|ping)?|done)\b[^.]{0,24}\bgenerators?\b|\bgenerators?\b[^.]{0,24}\b(?:complet(?:e|ed|es|ing)|finish(?:ed|es|ing)?|pop(?:s|ped)?|done)\b/ },
  unhook: { label: 'an unhook', re: /\bunhook(?:s|ed|ing)?\b/ },
  hit: { label: 'hitting a Survivor', re: /\b(?:hit(?:s|ting)?|damag(?:e|es|ed|ing))\s+(?:a |the |every |each |any |that |another )?(?:survivors?|obsession|them|someone|anyone|rescuers?|healers?|targets?)\b|\binjur(?:e|es|ed|ing)\b|\bbasic attacks?\b(?![^.]{0,12}\bdown)/ },
  stun: { label: 'a stun', re: /\bstun(?:s|ned|ning)?\b/ },
  blind: { label: 'blinding', re: /\bblind(?:s|ed|ing)?\b/ },
  cleanse: { label: 'a totem being cleansed', re: /\bcleans(?:e|ed|es|ing)\b/ },
  vault: { label: 'vaulting', re: /\b(?:you|they|survivors?|killer|he|she|someone|when|whenever|after|each|every) vault(?:s|ed)?\b|\bvaulting\b/ },
};

const EFFECTS = {
  regress: { label: 'generator regression', re: /\bexplo(?:de|des|ding|sion|sions)\b|\bblows? up\b|\bblowing up\b|\bblew up\b|\bregress(?:es|ed|ing|ion)?\b|\blos(?:e|es|ing) [^.]{0,14}progress\b/ },
  block: { label: 'generator blocking', re: /\bblock(?:s|ed|ing)?\b[^.]{0,20}\bgenerators?\b|\bgenerators?\b[^.]{0,20}\bblock(?:s|ed|ing)?\b/ },
  haste: { label: 'Haste', re: /\bhaste\b|\bmovement speed\b|\bmove(?:s|ment)? faster\b|\bmakes? you faster\b|\byou faster\b|\brun faster\b/ },
  hindered: { label: 'Hindered', re: /\bhindered\b/ },
  exposed: { label: 'Exposed', re: /\bexposed\b/ },
  undetectable: { label: 'Undetectable', re: /\bundetectable\b/ },
  oblivious: { label: 'Oblivious', re: /\boblivious\b/ },
  blindness: { label: 'Blindness', re: /\bblindness\b/ },
  broken: { label: 'Broken', re: /\bbroken\b/ },
  deepwound: { label: 'Deep Wound', re: /\bdeep wounds?\b/ },
  mangled: { label: 'Mangled', re: /\bmangled\b/ },
  haemorrhage: { label: 'Haemorrhage', re: /\bha?emorrhage\b/ },
  exhausted: { label: 'Exhausted', re: /\bexhaust(?:ed|ion)\b/ },
  endurance: { label: 'Endurance', re: /\bendurance\b/ },
  incapacitated: { label: 'Incapacitated', re: /\bincapacitated\b/ },
  aura: { label: 'aura reading', re: /\bauras? (?:reading|of|reveal)|\bsee[sn]?\b[^.]{0,40}\bauras?\b|\bauras?\b[^.]{0,20}\b(?:revealed|shown|visible)\b|\breveal(?:s|ed|ing)?\b[^.]{0,30}\bauras?\b/ },
  scream: { label: 'screams', re: /\bscream(?:s|ing)?\b/ },
  lunge: { label: 'longer lunges', re: /\blunges?\b/ },
};

// things the base game does without any perk
const BASE_GAME = new Set(['kick>regress', 'stun>blindness', 'hit>haste', 'unhook>haste', 'hook>scream', 'hit>scream', 'complete>aura']);
const EFFECT_IN_PERK = { regress: /\bexplode|\blos(?:e|es) [^.]{0,14}progress|\bregress/, block: /\bblock/ };

const ATTRIBUTED = /\b(?:power|add-?ons?|items?|offerings?|teammates?|team ?mates?|allies|ally|friends?|base ?kit|basekit|toolbox|flashlights?|med-?kits?|map|firecracker|killer'?s? (?:power|ability)|survivors? (?:can|will|who|might)|alternatives?|instead)\b/;
const MANUAL_OK = /\b(?:press(?:es|ing)?|use|using|activat(?:e|es|ing)|can|could|lets?|letting|allows?|option|choose|chance|ability|button|window|pick)\b/;
const RANGE_OK = /\b(?:within|nearby|near|close|range|around|in sight|radius|next to|metres?|meters?|\d+(?:\.\d+)?\s?m)\b/;
const SIGHT_OK = /\b(?:see|seen|sight|visible|look|looking|line of sight)\b/;
const BASIC_OK = /\bbasic\b/;
const UNIVERSAL = /\b(?:every|each|always|whenever|all|any time|automatically|guaranteed)\b/;
const KICK_OK = TRIGGERS.kick.re;
const SWAP_OK = /\b(?:instead|swaps?|swapp(?:ed|ing)|replace|alternatives?|or|alongside|teammates?|team ?mates?|ally|allies|friends?|pairs?|paired|combo|named as|in place of|over)\b/;
const ABSOLUTE = /\b(?:permanent(?:ly)?|instant(?:ly)?|guarantee[sd]?|impossible|every single|can'?t (?:be )?(?:escape|counter)|unbeatable|unescapable|inescapable)\b/;

// ------------------------------------------------------------- perk statements
/** A perk's live text as statements; bullet lines are joined to the header that introduces them. */
function statements(perk) {
  const out = [];
  let header = '';
  for (const raw of String(perk.text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('•')) { out.push(norm(`${header} ${line.slice(1)}`)); continue; }
    header = /:\s*$/.test(line) ? line : '';
    for (const s of line.split(/(?<=[.!?])\s+(?=[A-Z])/)) out.push(norm(s));
  }
  return out;
}

function perkInfo(perk) {
  if (perk._fc) return perk._fc;
  const st = statements(perk);
  const has = (re) => st.filter((s) => re.test(s));
  const autoSpend = st.filter((s) => /\bspend\b/.test(s) && /\b(?:whenever|when|each time)\b/.test(s) && !/ability button|use item button/.test(s));
  perk._fc = { st, has, tokens: st.some((s) => /\btokens?\b/.test(s)), autoSpend, cooldown: st.some((s) => /\bcooldown\b/.test(s)) };
  return perk._fc;
}

/** Statements of `perk` that link trigger -> effect (same statement, or chained through Tokens). */
function support(perk, trig, eff) {
  const info = perkInfo(perk);
  const effRe = EFFECT_IN_PERK[eff] || EFFECTS[eff].re;
  const tS = info.has(TRIGGERS[trig].re);
  const eS = info.has(effRe);
  if (!tS.length || !eS.length) return null;
  const same = tS.filter((s) => eS.includes(s));
  if (same.length) return same;
  // "The first time you hook each Survivor, they are hexed. The hexed Survivors: gain Oblivious."
  const order = info.st;
  for (const t of tS) {
    const ti = order.indexOf(t);
    const follow = eS.find((e) => order.indexOf(e) > ti && order.indexOf(e) - ti <= 3 && !/\b(?:whenever|when|each time|after|while|if)\b/.test(e));
    if (follow) return [t, follow];
  }
  if (info.tokens && tS.some((s) => /\btokens?\b/.test(s)) && eS.some((s) => /\btokens?\b/.test(s))) return [...tS, ...eS];
  return null;
}

// ------------------------------------------------------------------ helpers
function clausesOf(text) {
  return String(text || '')
    .split(/(?<=[.!?;])\s+|\s+(?:while|whereas|but|then)\s+|\s+[—–-]\s+|(?<!\b(?:Hex|Boon|Hook|Teamwork|Invocation)):\s+/i)
    .map((c) => c.trim())
    .filter((c) => c.length > 2);
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Same length as the input, accents and curly quotes folded, so match positions stay valid. */
const fold = (s) => [...String(s)].map((ch) => (ch === '’' || ch === '‘' ? "'" : ch.normalize('NFD')[0])).join('');

/** What unit a tunable is in, from its key ("hastelingerduration" -> s, "requireddistance" -> m). */
function unitOfKey(key) {
  const k = key.toLowerCase();
  if (k.includes('%')) return 'pct';
  if (/duration|time|cooldown|delay|linger|second/.test(k)) return 's';
  if (/distance|range|radius|meter|metre|size/.test(k)) return 'm';
  if (/token|stack|max|count|amount|number|survivors|hooks|generators|charges/.test(k)) return 'count';
  return 'any';
}
const UNIT_OF_TEXT = (u) => (/^%|^percent/.test(u) ? 'pct' : /^m$|^met/.test(u) ? 'm' : /^s$|^sec/.test(u) ? 's' : 'count');

/** Live numbers by unit, so a duration cannot pass as a distance. */
function numberSet(perks, constants) {
  const sets = { pct: new Set(), m: new Set(), s: new Set(), count: new Set([1, 2, 3, 4]), any: new Set() };
  const put = (unit, n) => typeof n === 'number' && sets[unit].add(Math.round(n * 1000) / 1000);
  for (const p of perks) {
    const fromText = new Map();
    for (const m of String(p.template || '').matchAll(/\{Tunable\.[^.}]+\.([^}]+)\}\s?(%|m(?![a-z])|s(?![a-z]))/gi)) {
      fromText.set(m[1].toLowerCase(), m[2] === '%' ? 'pct' : m[2].toLowerCase() === 'm' ? 'm' : 's');
    }
    for (const [k, v] of Object.entries(p.tunables || {})) if (Array.isArray(v)) for (const n of v) put(fromText.get(k.toLowerCase()) || unitOfKey(k), n);
  }
  const c = constants || {};
  for (const ch of Object.values(c.charges || {})) put('s', ch.seconds);
  if (c.regression) { put('count', c.regression.maxEvents); put('pct', c.regression.kickPct); put('count', c.regression.generatorCharges); }
  return { has: (n, textUnit) => { const u = UNIT_OF_TEXT(textUnit); return sets[u].has(n) || sets.any.has(n); } };
}

/**
 * Check one build's write-up.
 * build: { role, perks: [ids], alts: {id: [ids]}, summary, details, tips, checked? }
 * ctx:   { perkById: Map, allPerks: [], constants: {}, killers: [{name}] }
 * Returns { status: 'verified'|'flagged'|'stale'|'none', issues: [...], hashes }
 */
export function checkWriteup(build, ctx) {
  const perks = build.perks.map((id) => ctx.perkById.get(id)).filter(Boolean);
  const altIds = new Set(Object.values(build.alts || {}).flat());
  const altPerks = [...altIds].map((id) => ctx.perkById.get(id)).filter(Boolean);
  const hashes = Object.fromEntries(perks.map((p) => [p.id, perkHash(p)]));
  const issues = [];
  const fields = [['summary', build.summary], ['details', build.details], ...(build.tips || []).map((t, i) => [`tip ${i + 1}`, t])].filter(([, t]) => t && String(t).trim());
  if (!fields.length) return { status: 'none', issues, hashes };

  const numbers = numberSet([...perks, ...altPerks], ctx.constants);
  const killerShort = (ctx.killers || []).map((k) => k.name.replace(/^The /i, '')).filter((n) => n.length >= 3);
  const killerSet = new Set(killerShort.map((n) => n.toLowerCase()));
  // every name we can split a sentence at: perks (with renames) and killers
  const names = [];
  for (const p of ctx.allPerks || []) for (const n of [p.name, ...(p.altNames || [])]) {
    if (killerSet.has(n.toLowerCase())) continue; // "Nemesis" the perk vs The Nemesis
    const short = n.replace(/^(Hex|Boon|Scourge Hook|Teamwork|Invocation):\s*/i, '');
    for (const v of new Set([n, short, short.replace(/^The /, '')].map(fold))) if (v.length >= 4 || /\s/.test(v)) names.push({ kind: 'perk', p, n: v });
  }
  for (const k of killerShort) names.push({ kind: 'killer', n: fold(k) });
  names.sort((x, y) => y.n.length - x.n.length);
  const nameRe = new RegExp(`(?:^|(?<=[^A-Za-z]))(?:The )?(${names.map((x) => escRe(x.n)).join('|')})(?![A-Za-z])`, 'g');
  const nameOf = new Map(names.map((x) => [x.n, x]));

  const add = (field, rule, severity, clause, message) => {
    const key = `${field}:${rule}:${normName(clause).slice(0, 48)}`;
    if (!issues.some((i) => i.key === key && i.message === message)) issues.push({ key, field, rule, severity, clause, message });
  };
  const inBuild = (p) => build.perks.includes(p.id);

  /** Split a clause at each perk / killer name; each part is attributed to the name(s) that open it. */
  function segments(clause) {
    const out = [];
    // sub-clauses first (", and ...", "; ..."); a sub-clause naming one perk belongs to it entirely,
    // so "the first time you hook each Survivor, Plaything makes them Oblivious" is credited to Plaything
    for (const part of fold(clause).split(/,\s*(?=(?:and|but|while|so|whereas|then)\b)|;\s*/i)) {
      const hits = [...part.matchAll(nameRe)].map((m) => ({ at: m.index, who: nameOf.get(m[1]) }));
      const distinct = [...new Set(hits.map((h) => h.who))];
      if (distinct.length <= 1) { out.push({ text: part, who: distinct }); continue; }
      for (let i = 0; i < hits.length; i++) {
        const from = i === 0 ? 0 : hits[i].at; // leading words go with the first name
        out.push({ text: part.slice(from, i + 1 < hits.length ? hits[i + 1].at : part.length), who: [hits[i].who] });
      }
    }
    // "Overcharge and Oppression put ..." -> one part attributed to both
    for (let i = out.length - 2; i >= 0; i--) {
      const rest = out[i].text.replace(out[i].who[0]?.n || '', '').replace(/^\s*the\s*/i, '');
      if (out[i].who.length && /^[\s,]*(?:and|or|&|plus|with)?[\s,]*$/i.test(rest)) {
        out[i + 1] = { text: out[i].text + out[i + 1].text, who: [...out[i].who, ...out[i + 1].who] };
        out.splice(i, 1);
      }
    }
    return out;
  }

  function checkCausal(field, clause, segText, who, clauseNamed) {
    const c = norm(fold(segText).replace(nameRe, ' the perk ')).replace(/\b(?:pallets?|walls?|locks?|it)\b[^.]{0,20}\bbroken\b|\bbroken\s+(?:pallets?|walls?)\b|\bper (?:pallet|wall) broken\b/g, ' ');
    if (ATTRIBUTED.test(c)) return;
    const killerPart = who.some((w) => w.kind === 'killer');
    if (killerPart && !who.some((w) => w.kind === 'perk')) return; // about a killer's power: not checkable from perk data
    const named = who.filter((w) => w.kind === 'perk').map((w) => w.p);
    if (named.length && named.every((p) => !inBuild(p))) return; // about a perk outside the build (reported separately)
    const scope = named.filter(inBuild).length ? named.filter(inBuild) : perks;

    const trigs = Object.keys(TRIGGERS).filter((t) => TRIGGERS[t].re.test(c));
    const negated = (e) => new RegExp(`\\b(?:remov\\w*|block\\w*|hid(?:e|es|ing)|stops?|prevent\\w*|los(?:e|es|ing)|without|no longer|can'?t|cannot|den(?:y|ies)|strips?|cuts?)\\b[^.]{0,30}(?:${EFFECTS[e].re.source})`).test(c);
    let effs = Object.keys(EFFECTS).filter((e) => EFFECTS[e].re.test(c) && !negated(e));
    // in a killer build "blind" describes Blindness on Survivors, unless the killer is the one being blinded
    if (build.role === 'killer' && trigs.includes('blind') && !/\b(?:you are|you're|killer is|killer gets|gets?|is) blinded\b|\bblinded by\b|\bblinds? (?:you|the killer)\b|\b(?:every|each|a|any) blind\b|\bflashlight|\bflashbang|\bfirecracker/.test(c)) {
      trigs.splice(trigs.indexOf('blind'), 1);
      if (!effs.includes('blindness')) effs.push('blindness');
    }
    if (trigs.includes('blind') && effs.includes('blindness')) trigs.splice(trigs.indexOf('blind'), 1);
    // "a rescuer who is Exposed": a state, not something the trigger causes
    const states = effs.filter((e) => new RegExp(`\\b(?:is|are|who's|already|still|while|stays?)\\s+(?:${EFFECTS[e].re.source})|(?:${EFFECTS[e].re.source})\\s+(?:survivors?|targets?|rescuers?|players?)\\b`).test(c));
    const causal = effs.filter((e) => !states.includes(e));
    const gives = (p, e) => perkInfo(p).has(EFFECT_IN_PERK[e] || EFFECTS[e].re).length > 0;

    for (const e of states) {
      if (e === 'aura' || e === 'scream' || e === 'regress') continue;
      if (!perks.some((p) => gives(p, e))) add(field, 'unsupported-effect', 'error', clause, `nothing in this build gives ${EFFECTS[e].label}`);
    }
    if (causal.length && trigs.length) {
      const pairs = [];
      for (const t of trigs) for (const e of causal) {
        if (BASE_GAME.has(`${t}>${e}`)) { pairs.push({ t, e, base: true }); continue; }
        for (const p of scope) { const st = support(p, t, e); if (st) pairs.push({ t, e, p, s: st }); }
      }
      for (const t of trigs) {
        if (pairs.some((x) => x.t === t)) continue;
        const other = perks.filter((p) => !scope.includes(p)).find((p) => causal.some((e) => support(p, t, e)));
        if (other && clauseNamed.includes(other)) continue; // "... and Hope adds Haste once the generators are done"
        if (other) add(field, 'misattributed', 'error', clause, `${named.map((p) => p.name).join(' / ')} does not do that — ${other.name} is the perk that links ${TRIGGERS[t].label} to ${causal.map((e) => EFFECTS[e].label).join(' / ')}`);
        else add(field, 'unsupported-trigger', 'error', clause, `no perk in this build makes ${TRIGGERS[t].label} cause ${causal.map((e) => EFFECTS[e].label).join(' or ')}`);
      }
      for (const e of causal) {
        if (pairs.some((x) => x.e === e) || scope.some((p) => gives(p, e)) || clauseNamed.some((p) => gives(p, e))) continue;
        add(field, 'unsupported-effect', 'error', clause, named.length ? `${named.map((p) => p.name).join(' / ')} does not give ${EFFECTS[e].label}` : `nothing in this build gives ${EFFECTS[e].label}`);
      }
      // conditions the claim must not drop
      for (const { t, e, p, s: st } of pairs) {
        if (!p) continue;
        const joined = st.join(' ');
        const name = p.name;
        if (/ability button|use item button/.test(joined) && !MANUAL_OK.test(c)) add(field, 'manual', 'error', clause, `${name} is not automatic: you have to press the ability button`);
        if (/\bbasic attack\b/.test(joined) && (t === 'down' || t === 'hit') && !BASIC_OK.test(c)) add(field, 'basic-attack', 'warn', clause, `${name} only counts ${t === 'down' ? 'downs' : 'hits'} made with a basic attack`);
        const r = /\bwithin (\d+(?:\.\d+)?)m\b/.exec(joined);
        if (r && !RANGE_OK.test(c)) add(field, 'range', 'warn', clause, `${name} only works within ${r[1]} m`);
        if (/\byou can see\b/.test(joined) && !SIGHT_OK.test(c)) add(field, 'sight', 'warn', clause, `${name} needs the generator to be in sight`);
        const single = /\btarget generator\b|\bthe generator with the most progress\b|\b1 generator\b/.test(joined) && !/\bgenerators within\b|\ball generators\b/.test(joined);
        if (single && e === 'regress' && /\bgenerators\b/.test(c) && !/\b(?:one|a|1|single|the)\b[^.]{0,30}\bgenerator\b(?!s)/.test(c)) add(field, 'single-target', 'warn', clause, `${name} affects one generator, not several`);
        if (/\bthe first time\b/.test(joined) && (UNIVERSAL.test(c) || /\beach (?:trip|time|hook)\b/.test(c)) && !/\bfirst\b/.test(c)) add(field, 'first-time', 'warn', clause, `${name} only triggers the first time (per Survivor / per generator)`);
        if (/\bwhen you damage a generator\b/.test(joined) && t !== 'kick' && !KICK_OK.test(c)) add(field, 'needs-kick', 'warn', clause, `${name} also needs you to damage (kick) the generator`);
        if (perkInfo(p).cooldown && UNIVERSAL.test(c)) add(field, 'cooldown', 'info', clause, `${name} has a cooldown`);
      }
    } else if (causal.length) {
      for (const e of causal) {
        if (e === 'aura' || e === 'scream' || e === 'regress') continue; // often background facts ("generators regress")
        if (!scope.some((p) => gives(p, e)) && !clauseNamed.some((p) => gives(p, e))) add(field, 'unsupported-effect', 'error', clause, named.length && scope !== perks ? `${named.map((p) => p.name).join(' / ')} does not give ${EFFECTS[e].label}` : `nothing in this build gives ${EFFECTS[e].label}`);
      }
    }
  }

  for (const [field, text] of fields) {
    for (const clause of clausesOf(text)) {
      const c = norm(clause);

      // --- 5. perks named in the text
      for (const m of fold(clause).matchAll(nameRe)) {
        const w = nameOf.get(m[1]);
        if (w.kind !== 'perk' || inBuild(w.p) || altIds.has(w.p.id)) continue;
        if (!/[\s:]/.test(w.n) && fold(clause).trimStart().startsWith(w.n) && !perks.some((x) => x.name === w.n)) continue; // sentence-start word
        const otherSide = w.p.role !== build.role; // "counters Sprint Burst" in a killer build
        add(field, 'perk-not-in-build', otherSide || SWAP_OK.test(c) ? 'info' : 'warn', clause, `mentions ${w.p.name}, which is not in this build`);
      }

      // --- 4. numbers (usage statistics are not perk values: they belong in the evidence field)
      const statistic = /\b(?:pick rate|kill rate|escape rate|loadouts?|usage|recorded|most[- ]picked|picked|in the data|dataset|of (?:all )?(?:matches|games|players)|win rate|average)\b/.test(c);
      if (statistic) add(field, 'statistic', 'info', clause, 'usage statistic: keep it in the evidence field with its date range');
      if (!statistic) for (const m of c.matchAll(/(\d+(?:\.\d+)?)\s?(%|percent\b|m\b|metres?\b|meters?\b|s\b|secs?\b|seconds?\b|tokens?\b)/g)) {
        const n = Math.round(Number(m[1]) * 1000) / 1000;
        if (!numbers.has(n, m[2].trim())) add(field, 'number', 'error', clause, `${m[1]}${m[2].trim()} is not a live value of these perks — write it as a value token like {{Perk Name|key}}`);
      }

      // --- 1/2/3. causes, effects and their conditions, per attributed part
      const segs = segments(clause);
      const clauseNamed = [...new Set(segs.flatMap((sg) => sg.who.filter((w) => w.kind === 'perk' && inBuild(w.p)).map((w) => w.p)))];
      for (const seg of segs) checkCausal(field, clause, seg.text, seg.who, clauseNamed);
      // a named perk's own trigger conditions, even when cause and perk sit in different parts of the sentence
      // ("each trip can trigger Pain Resonance" -> Pain Resonance only fires the first time)
      const clauseTrigs = Object.keys(TRIGGERS).filter((t) => TRIGGERS[t].re.test(c));
      for (const p of clauseNamed) {
        for (const t of clauseTrigs) {
          const st = perkInfo(p).has(TRIGGERS[t].re);
          if (!st.length) continue;
          const joined = st.join(' ');
          if (/\bthe first time\b/.test(joined) && (UNIVERSAL.test(c) || /\beach (?:trip|time|hook|survivor)\b/.test(c)) && !/\bfirst\b/.test(c)) add(field, 'first-time', 'warn', clause, `${p.name} only triggers the first time (per Survivor / per generator)`);
          if (/\bbasic attack\b/.test(joined) && (t === 'down' || t === 'hit') && !BASIC_OK.test(c)) add(field, 'basic-attack', 'warn', clause, `${p.name} only counts ${t === 'down' ? 'downs' : 'hits'} made with a basic attack`);
          if (/ability button|use item button/.test(joined) && /\b(?:every|each|whenever|always|automatically)\b/.test(c) && !MANUAL_OK.test(c)) add(field, 'manual', 'error', clause, `${p.name} is not automatic: you have to press the ability button`);
        }
      }

      // --- Tokens that are spent automatically cannot be "saved"
      if (/\b(?:sav(?:e|es|ing)|keep(?:s|ing)?|bank(?:s|ing)?|stor(?:e|es|ing)|conserv(?:e|ing))\b[^.]{0,40}\btokens?\b|\btokens?\b[^.]{0,30}\b(?:sav(?:e|ed|ing)|bank(?:ed|ing)?)\b/.test(c)) {
        for (const p of perks) {
          const info = perkInfo(p);
          if (!info.autoSpend.length) continue;
          if (c.includes(norm(p.name).trim()) || perks.filter((x) => perkInfo(x).tokens).length === 1) add(field, 'auto-tokens', 'error', clause, `${p.name} spends its Tokens automatically, so they cannot be saved`);
        }
      }

      if (ABSOLUTE.test(c) && !perks.some((p) => perkInfo(p).st.some((x) => ABSOLUTE.test(x)))) add(field, 'absolute', 'info', clause, 'absolute wording — make sure it really always holds');
    }
  }

  // waivers: an issue a reviewer accepted with a reason, valid only while the perks are unchanged
  const stamp = build.checked;
  const stampValid = !!stamp?.perks && build.perks.every((id) => stamp.perks[id] === hashes[id]);
  const waived = new Set(stampValid ? (stamp.accepted || []).filter((a) => a.reason && a.key).map((a) => a.key) : []);
  for (const i of issues) if (waived.has(i.key)) i.waived = true;
  const blocking = issues.filter((i) => !i.waived && (i.severity === 'error' || i.severity === 'warn'));
  let status = blocking.length ? 'flagged' : 'verified';
  if (status === 'verified' && build.requireStamp && !stampValid) {
    status = 'stale';
    const changed = stamp?.perks ? build.perks.filter((id) => stamp.perks[id] && stamp.perks[id] !== hashes[id]).map((id) => ctx.perkById.get(id)?.name) : [];
    issues.push({ key: 'stamp', field: 'all', rule: 'stale', severity: 'warn', clause: '', message: changed.length ? `${changed.join(', ')} changed since this write-up was reviewed` : 'this write-up has not been reviewed against the current perk text yet' });
  }
  return { status, issues, hashes };
}

/** A summary that is true by construction: what the build does, from its tags, and its perks. */
export function autoSummary(build, perks, tagLabel) {
  const skip = new Set(['video', 'recommended', 'meta', 'toxic', 'fun', 'beginner', 'creator', 'mine', 'diminishing-returns']);
  const tags = (build.tags || []).filter((t) => !skip.has(t) && !t.includes(':')).slice(0, 3).map((t) => (tagLabel ? tagLabel(t) : t));
  const names = perks.map((p) => p.name);
  const list = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return tags.length ? `${tags.join(' · ')} — ${list}.` : `${list}.`;
}
