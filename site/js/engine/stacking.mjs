// Diminishing Returns (DR) calculator.
//
// Since patch 9.6.0 the game reduces repeated identical modifiers: the highest
// value applies in full and each further one is cut to a fraction of itself
// (100% / 50% / 25% / 12.5% / 5%). This module finds the modifiers a build
// repeats, ranks them strongest-first exactly as the game does, and reports
// what the build really gets versus what the perk text adds up to.
//
// Perk values come from live game data (see effects.mjs); the rule constants
// come from data/rules.json so a rule change is a data edit, not a code edit.

import { ACTION_LABELS } from './effects.mjs';
import { valueAtTier, formatNumber } from './text.mjs';

export const DEFAULT_STEPS = [1, 0.5, 0.25, 0.125, 0.05];

export function drSteps(rules) {
  const s = rules?.dr?.steps;
  return Array.isArray(s) && s.length ? s : DEFAULT_STEPS;
}

/** Apply DR to a list of magnitudes. Returns them strongest-first with factors. */
export function applyDR(items, steps = DEFAULT_STEPS) {
  const sorted = [...items].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return sorted.map((it, i) => {
    const factor = steps[Math.min(i, steps.length - 1)];
    return { ...it, rank: i + 1, factor, effective: it.value * factor };
  });
}

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

const MODIFIER_LABELS = {
  'cooldown-hit': 'Successful attack cooldown',
  'cooldown-miss': 'Missed attack cooldown',
  stun: 'Stun duration',
  lunge: 'Lunge duration',
  'skillcheck-chance': 'Skill Check chance',
};

const TARGET_LABEL = {
  self: 'you',
  'self+ally': 'you and your partner',
  allies: 'your teammates',
  team: 'the whole team',
  survivors: 'Survivors',
  killer: 'the Killer',
};

function groupKey(e) {
  // "identical modifier" = same kind of modifier landing on the same recipient
  const who = e.target === 'self+ally' ? 'self' : e.target === 'team' ? 'allies' : e.target || 'self';
  if (e.kind === 'haste' || e.kind === 'hindered') return `${e.kind}|${who}`;
  if (e.kind === 'action') return `action:${e.action}|${who}|${e.sign > 0 ? 'pos' : 'neg'}`;
  if (e.kind === 'modifier') return `mod:${e.key}|${who}|${e.sign > 0 ? 'pos' : 'neg'}`;
  // bonuses that several perks add to the SAME generator kick
  if (e.kind === 'regression' && e.onKick) return 'kickbonus|generator|pos';
  return null;
}

function groupLabel(key) {
  const [kind, who, sign] = key.split('|');
  const on = TARGET_LABEL[who] || who;
  if (kind === 'haste') return { title: 'Haste', on, unit: '%', positive: true };
  if (kind === 'hindered') return { title: 'Hindered', on, unit: '%', positive: false };
  if (kind === 'kickbonus') return { title: 'Extra regression on a kick', on: 'the kicked generator', unit: '%', positive: true, unconfirmed: true };
  if (kind.startsWith('action:')) return { title: ACTION_LABELS[kind.slice(7)] || kind.slice(7), on, unit: '%', positive: sign === 'pos', action: kind.slice(7) };
  return { title: MODIFIER_LABELS[kind.slice(4)] || kind.slice(4), on, unit: '%', positive: sign === 'pos' };
}

/** Magnitude a perk contributes, at a tier; token-scaled perks are taken at full stacks. */
function magnitude(e, tier) {
  const per = valueAtTier(e.values, tier);
  if (typeof per !== 'number') return null;
  if (e.scaling && e.scaling.max) return { value: per * e.scaling.max, per, stacks: e.scaling.max, unit: e.scaling.per };
  if (e.scaling) return { value: per, per, stacks: 1, unit: e.scaling.per, open: true };
  return { value: per };
}

/**
 * Analyse the four perks of a build.
 * perks: perk objects carrying .fx (from extractEffects)
 * rules: contents of data/rules.json
 * opts:  { role, killer: character object (for base speed), tier }
 */
export function analyseBuild(perks, rules = {}, opts = {}) {
  const tier = opts.tier || 3;
  const steps = drSteps(rules);
  const constants = rules?.constants || {};
  const ruleById = (id) => (rules?.rules || []).find((r) => r.id === id && r.confidence !== 'low');

  const buckets = new Map();
  for (const p of perks) {
    if (!p?.fx) continue;
    // a perk counts once per group: keep its largest contribution, note any bonus tiers
    const own = new Map();
    for (const e of p.fx.effects) {
      const key = groupKey(e);
      if (!key) continue;
      const mag = magnitude(e, tier);
      if (!mag || !mag.value) continue;
      const prev = own.get(key);
      if (e.bonus && prev) { prev.value += mag.value; prev.bonus = mag.value; continue; }
      if (!prev || mag.value > prev.value) own.set(key, { perk: p.id, name: p.name, when: e.when, duration: e.duration ? valueAtTier(e.duration, tier) : null, extra: !!e.extra, ...mag });
    }
    for (const [key, entry] of own) {
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(entry);
    }
  }

  const groups = [];
  const singles = [];
  for (const [key, entries] of buckets) {
    const label = groupLabel(key);
    if (entries.length < 2) {
      const e = entries[0];
      if (key.startsWith('kickbonus')) continue; // listed under instant regression instead
      const single = { key, ...label, perk: e.perk, name: e.name, value: round(e.value), stacks: e.stacks, per: e.per, unitOf: e.unit, when: e.when };
      if (key === 'haste|self') {
        const baseSpeed = opts.role === 'killer' ? opts.killer?.speed || constants.killerSpeed : constants.survivorSpeed;
        if (baseSpeed) single.example = { what: 'Movement speed', unit: 'm/s', base: baseSpeed, actual: round(baseSpeed * (1 + e.value / 100)) };
      }
      singles.push(single);
      continue;
    }
    const ranked = applyDR(entries, steps).map((e) => ({ ...e, value: round(e.value), effective: round(e.effective, 3) }));
    let paper, actual;
    if (label.positive) {
      // bonuses add together
      paper = ranked.reduce((s, e) => s + e.value, 0);
      actual = ranked.reduce((s, e) => s + e.effective, 0);
    } else {
      // penalties multiply: 1 - Π(1 - p)
      paper = (1 - ranked.reduce((s, e) => s * (1 - e.value / 100), 1)) * 100;
      actual = (1 - ranked.reduce((s, e) => s * (1 - e.effective / 100), 1)) * 100;
    }
    const g = {
      key, ...label,
      entries: ranked,
      paper: round(paper), actual: round(actual), lost: round(paper - actual),
      efficiency: paper ? round((actual / paper) * 100, 1) : 100,
    };

    // worked example, where the base number is a verified constant
    const base = label.action ? constants.charges?.[label.action] : null;
    if (base && base.seconds) {
      const mult = label.positive ? 1 + actual / 100 : 1 - actual / 100;
      const multPaper = label.positive ? 1 + paper / 100 : 1 - paper / 100;
      g.example = { what: base.label, base: base.seconds, actual: round(base.seconds / mult, 1), paper: round(base.seconds / multPaper, 1) };
    }
    if (key === 'haste|self') {
      const baseSpeed = opts.role === 'killer' ? opts.killer?.speed || constants.killerSpeed : constants.survivorSpeed;
      if (baseSpeed) g.example = { what: 'Movement speed', unit: 'm/s', base: baseSpeed, actual: round(baseSpeed * (1 + actual / 100)), paper: round(baseSpeed * (1 + paper / 100)) };
    }
    groups.push(g);
  }
  groups.sort((a, b) => b.lost - a.lost);

  // --- interactions that are not DR but change what stacking is worth -------
  const notes = [];
  const flagged = (f) => perks.filter((p) => p?.fx?.flags?.[f]);
  const withEffect = (k) => perks.filter((p) => p?.fx?.effects.some((e) => e.kind === k));
  const names = (list) => list.map((p) => p.name);
  const note = (id, perkList, text) => {
    const r = ruleById(id);
    if (!r) return; // only state rules that were verified against a source
    notes.push({ id, title: r.title, text: text || r.rule, perks: perkList.map((p) => p.id), source: r.sources?.[0]?.url || null });
  };

  const exhaustion = withEffect('exhaustion');
  if (exhaustion.length >= 2) note('exhaustion', exhaustion, `${names(exhaustion).join(' and ')} all cause Exhausted, and none of them can trigger while you are Exhausted — only one fires at a time.`);
  const hexes = flagged('hex');
  if (hexes.length >= 2) note('hex-totems', hexes);
  const scourge = flagged('scourge');
  if (scourge.length >= 2) note('scourge-hooks', scourge);
  const boons = flagged('boon');
  if (boons.length >= 2) note('boons', boons);

  const regress = perks.filter((p) => p?.fx?.effects.some((e) => e.kind === 'regression' && !e.onMiss));
  let regression = null;
  if (regress.length) {
    const items = regress.map((p) => {
      const e = p.fx.effects.find((x) => x.kind === 'regression' && !x.onMiss);
      const mag = magnitude(e, tier);
      return { perk: p.id, name: p.name, value: round(mag.value), onKick: !!e.onKick, multi: !!e.multi, stacks: mag.stacks, per: mag.per };
    });
    const rc = constants.regression || {};
    regression = { items, total: round(items.reduce((s, i) => s + i.value, 0)), maxEvents: rc.maxEvents || null, kickPct: rc.kickPct || null, generatorCharges: rc.generatorCharges || null };
    if (regress.length >= 2) note('regression-events', regress);
  }

  const status = groups.length ? 'active' : 'none';
  let headline;
  if (groups.length) {
    const g = groups[0];
    headline = `${g.title}: ${g.positive ? '+' : '−'}${formatNumber(g.paper)}% on paper, ${g.positive ? '+' : '−'}${formatNumber(g.actual)}% in a trial`;
  } else {
    headline = 'No repeated modifiers — every perk applies at full value';
  }
  return { status, headline, steps, groups, singles, regression, notes };
}
