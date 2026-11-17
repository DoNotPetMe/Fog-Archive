// Extracts mechanical effects from a perk's live description template.
//
// The game's perk text is written in a fixed house style
// ("You heal {X}% faster", "gain {X}% {Keyword.Haste} for {Y}s", ...), so the
// numbers that matter for stacking can be read straight from the template and
// its tunables. Nothing here is a hand-typed perk value: when a patch changes a
// number or rewrites a perk, the next sync re-derives its effects.

import { tunableValues } from './text.mjs';

const ACTIONS = [
  // [id, label, regex tested against the words in front of "{X}% faster/slower"]
  ['repair', 'Repair speed', /\brepairs?\b/],
  ['heal', 'Healing speed', /\bheals?\b(?! progress)/],
  ['recover', 'Recovery speed', /\brecovers?\b/],
  ['cleanse', 'Totem cleansing speed', /\bcleanses?\b/],
  ['bless', 'Totem blessing speed', /\bbless(es)?\b/],
  ['unhook', 'Unhook speed', /\bunhooks?\b/],
  ['gates', 'Exit Gate opening speed', /\bopens? (the )?exit gates?\b/],
  ['sabotage', 'Sabotage speed', /\bsabotages?\b/],
  ['chest', 'Chest search speed', /\b(unlock|rummage|search)[a-z ,]*chests?\b|\bchests?\b/],
  ['vault', 'Vault speed', /\bvaults?\b/],
  ['break', 'Pallet / wall break speed', /\bbreaks?\b/],
  ['kick', 'Generator damage speed', /\bdamages? generators\b/],
  ['hook', 'Hooking speed', /\bhooks? survivors\b/],
  ['pickup', 'Pick-up speed', /\bpick-?up\b/],
  ['locker', 'Locker search speed', /\bopens? lockers\b/],
  ['wiggle', 'Wiggle speed', /\bwiggles?\b/],
];

export const ACTION_LABELS = Object.fromEntries(ACTIONS.map(([id, label]) => [id, label]));

const TUN = /\{Tunable\.[^.}]+\.([^}]+)\}/;
const TUN_G = /\{Tunable\.[^.}]+\.([^}]+)\}/g;

/** Break a template into clauses, remembering the "header:" a bullet list hangs off. */
function clauses(template) {
  const out = [];
  let header = '';
  let inList = false;
  // tokens: tags we care about, everything else is text
  const parts = template.split(/(<\/?ul>|<\/?li>|<br\s*\/?>)/i);
  let pendingText = '';
  const flush = (asListItem) => {
    const t = pendingText.trim();
    pendingText = '';
    if (!t) return;
    // split sentences, but not inside {...} or on decimals
    const sentences = t.split(/(?<=[.!?])\s+(?=[A-Z{])/);
    for (const s of sentences) {
      out.push({ text: s.trim(), header: asListItem ? header : '' });
    }
  };
  for (const p of parts) {
    if (!p) continue;
    const tag = p.toLowerCase();
    if (tag === '<ul>') {
      // the text right before a list is its header ("Survivors within range:")
      const t = pendingText.trim();
      const sentences = t.split(/(?<=[.!?])\s+(?=[A-Z{])/);
      header = sentences.pop() || '';
      pendingText = sentences.join(' ');
      flush(false);
      if (header) out.push({ text: header, header: '', isHeader: true });
      inList = true;
    } else if (tag === '</ul>') {
      flush(true);
      inList = false;
      header = '';
    } else if (tag === '<li>' || tag === '</li>') {
      flush(inList);
    } else if (/^<br/.test(tag)) {
      flush(inList);
      if (!inList) header = '';
    } else {
      pendingText += p;
    }
  }
  flush(inList);
  return out;
}

function durationAfter(text, fromIndex, perk) {
  const m = /^[^.]*?\bfor (?:the next )?\{Tunable\.[^.}]+\.([^}]+)\}s/.exec(text.slice(fromIndex));
  return m ? tunableValues(perk, m[1]) : null;
}

function plain(text) {
  return text
    .replace(TUN_G, 'X')
    .replace(/\{Keyword\.([^}]+)\}/g, '$1')
    .replace(/\{[^}]+\}/g, 'the ability button')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Who receives an effect: the subject of the nearest sub-clause in front of the value. */
function subjectOf(role, before, header) {
  const SUBJECTS = [
    [/\byou both\b/, 'self+ally'],
    [/\ball survivors\b/, role === 'survivor' ? 'team' : 'survivors'],
    [/\bother survivors?\b|\bthe survivor\b|\bthe carried survivor\b|\bthey\b|\bsurvivors\b|\bthe obsession\b/, role === 'survivor' ? 'allies' : 'survivors'],
    [/\bthe killer\b/, 'killer'],
    [/\byou\b|\byour\b/, 'self'],
  ];
  const first = (s) => {
    let best = null;
    for (const [re, who] of SUBJECTS) {
      const m = re.exec(s);
      if (m && (!best || m.index < best.index)) best = { index: m.index, who };
    }
    return best?.who || null;
  };
  // "Whenever you unhook a Survivor, they gain ..." -> the last sub-clause ("they gain") decides
  const parts = plain(before).toLowerCase().split(/[,:;]/);
  for (let i = parts.length - 1; i >= 0; i--) {
    const who = first(parts[i]);
    if (who) return who;
  }
  const head = plain(header || '').toLowerCase().split(/[,:;]/);
  for (let i = head.length - 1; i >= 0; i--) {
    const who = first(head[i]);
    if (who) return who;
  }
  return 'self';
}

/** Does "for each ..." govern the value at [start,end) of this clause? */
function scalingOf(text, header, key, perk, start = 0, end = text.length) {
  const before = plain(text.slice(0, start)).toLowerCase();
  const after = plain(text.slice(end)).toLowerCase().split(/[,.;]/)[0];
  const head = plain(header || '').toLowerCase();
  const lastPart = before.split(/[,;]/).pop();
  // "For each Token, gain X%" (leading) or "X% ... for each other Survivor" (trailing)
  const own = /\bfor each\b/.test(before) || /\bfor each\b/.test(after);
  const viaHeader = /\bfor each\b/.test(head);
  if (!own && !viaHeader && !/pertoken|persurvivor|perstack/i.test(key)) return null;
  const ctx = own ? `${before} ${after}` : head;
  let per = 'Token';
  let max = null;
  if (/for each (other )?survivor|for each (injured|downed|hooked)/.test(ctx) || /persurvivor/i.test(key)) {
    per = /injured|downed|hooked/.test(ctx) ? 'injured, downed or hooked Survivor' : 'Survivor';
    max = /other survivor/.test(ctx) ? 3 : 4;
  } else if (/for each hook state/.test(ctx)) {
    per = 'Hook State';
    max = 2;
  } else if (/for each charge/.test(ctx)) {
    per = 'Charge';
  } else if (/for each additional/.test(ctx)) {
    per = 'additional one';
  } else {
    const mt = tunableValues(perk, 'maxtokens') || tunableValues(perk, 'maxstacks') || tunableValues(perk, 'tokenmax') || tunableValues(perk, 'maximumtokens');
    max = mt ? mt[mt.length - 1] : null;
  }
  return { per, max };
}

export function extractEffects(perk) {
  const template = perk.template || '';
  const role = perk.role;
  const effects = [];
  const whole = plain(template).toLowerCase();
  const list = clauses(template);

  for (const c of list) {
    if (c.isHeader && !TUN.test(c.text)) continue;
    const text = c.text;
    const ctxPlain = plain((c.header ? c.header + ' ' : '') + text);
    let m;

    // --- Haste / Hindered -------------------------------------------------
    const speedRe = /\{Tunable\.[^.}]+\.([^}]+)\}% (more )?\{Keyword\.(Haste|Hindered)\}/gi;
    while ((m = speedRe.exec(text))) {
      const values = tunableValues(perk, m[1]);
      if (!values) continue;
      effects.push({
        kind: m[3].toLowerCase() === 'haste' ? 'haste' : 'hindered',
        values,
        extra: !!m[2],
        target: subjectOf(role, text.slice(0, m.index), c.header),
        scaling: scalingOf(text, c.header, m[1], perk, m.index, m.index + m[0].length),
        duration: durationAfter(text, m.index + m[0].length, perk),
        when: ctxPlain,
      });
    }

    // --- action speed ("... {X}% faster/slower") ---------------------------
    const actRe = /\{Tunable\.[^.}]+\.([^}]+)\}% (faster|slower)/gi;
    let prevEnd = 0;
    while ((m = actRe.exec(text))) {
      const values = tunableValues(perk, m[1]);
      const before = plain(text.slice(prevEnd, m.index)).toLowerCase();
      const headPlain = plain(c.header || '').toLowerCase();
      prevEnd = m.index + m[0].length;
      if (!values) continue;
      // regression-rate modifiers are not action speeds
      if (/\bregress(es)?\b/.test(before)) {
        effects.push({ kind: 'regression-rate', values, sign: m[2] === 'faster' ? 1 : -1, relative: true, scaling: scalingOf(text, c.header, m[1], perk, m.index, m.index + m[0].length), when: ctxPlain });
        continue;
      }
      if (/skill checks?|scratch marks|\bspin\b|\bappear\b|lose (healing )?progress|\bexhausted\b|pools of blood|grunts/.test(before)) continue;
      let acts = ACTIONS.filter(([id, , re]) => re.test(before)).map(([id]) => id);
      if (!acts.length && /all above actions/.test(before + ' ' + plain(text).toLowerCase())) acts = ['__above__'];
      if (!acts.length) acts = ACTIONS.filter(([id, , re]) => re.test(headPlain)).map(([id]) => id);
      if (!acts.length) continue;
      // "break Pallets ... and damage Generators" both match; "vault" inside "basic-vault" is fine
      const sign = m[2] === 'faster' ? 1 : -1;
      const target = subjectOf(role, text.slice(0, m.index), c.header);
      const scaling = scalingOf(text, c.header, m[1], perk, m.index, m.index + m[0].length);
      for (const action of acts) {
        effects.push({ kind: 'action', action, sign, values, target, scaling, duration: durationAfter(text, m.index + m[0].length, perk), when: ctxPlain });
      }
    }

    // --- other percentage modifiers (cooldowns, stuns, lunge, skill checks) --
    const modRe = /\{Tunable\.[^.}]+\.([^}]+)\}% (shorter|longer|more often|more likely to appear|more basic Skill Checks)/gi;
    while ((m = modRe.exec(text))) {
      const values = tunableValues(perk, m[1]);
      if (!values) continue;
      const before = plain(text.slice(0, m.index)).toLowerCase();
      const word = m[2].toLowerCase();
      const keys = [];
      if (word === 'shorter' && /cooldown/.test(before)) {
        if (/successful/.test(before)) keys.push('cooldown-hit');
        else if (/miss/.test(before)) keys.push('cooldown-miss');
        else keys.push('cooldown-hit', 'cooldown-miss');
      } else if (word === 'shorter' && /stuns?\b/.test(before)) keys.push('stun');
      else if (word === 'longer' && /lunge/.test(before)) keys.push('lunge');
      else if (/more (often|likely|basic)/.test(word)) keys.push('skillcheck-chance');
      const target = subjectOf(role, text.slice(0, m.index), c.header);
      for (const key of keys) {
        effects.push({ kind: 'modifier', key, sign: 1, values, target, scaling: scalingOf(text, c.header, m[1], perk, m.index, m.index + m[0].length), duration: durationAfter(text, m.index + m[0].length, perk), when: ctxPlain });
      }
    }

    // --- instant generator regression ("loses {X}% (more) progress") -------
    if (role === 'killer' && /generator/i.test(template)) {
      const regRe = /\blose[s]? \{Tunable\.[^.}]+\.([^}]+)\}% (more )?progress/gi;
      while ((m = regRe.exec(text))) {
        const values = tunableValues(perk, m[1]);
        if (!values) continue;
        const onMiss = /\bmiss(es)?\b/i.test(plain(text));
        effects.push({
          kind: 'regression',
          values,
          onKick: !!m[2] && !onMiss, // "X% more progress" = added on top of a kick
          onMiss,
          scaling: scalingOf(text, c.header, m[1], perk, m.index, m.index + m[0].length),
          multi: /\ball generators\b|\bgenerators within\b/i.test(ctxPlain),
          when: ctxPlain,
        });
      }
      // passive regression speed ("regresses at {X}% speed")
      const rateRe = /\bregress(?:es)? at \{Tunable\.[^.}]+\.([^}]+)\}% speed/gi;
      while ((m = rateRe.exec(text))) {
        const values = tunableValues(perk, m[1]);
        if (values) effects.push({ kind: 'regression-rate', values, relative: false, when: ctxPlain });
      }
      const rampRe = /regression speed will go from \{Tunable\.[^.}]+\.([^}]+)\}% to \{Tunable\.[^.}]+\.([^}]+)\}%/i.exec(text);
      if (rampRe) {
        const hi = tunableValues(perk, rampRe[2]);
        if (hi) effects.push({ kind: 'regression-rate', values: hi, relative: false, ramp: true, when: ctxPlain });
      }
    }

    // --- Exhaustion --------------------------------------------------------
    if (role === 'survivor' && /\byou gain \{Keyword\.Exhausted\}/i.test(text)) {
      const d = /\{Keyword\.Exhausted\} for \{Tunable\.[^.}]+\.([^}]+)\}s/i.exec(text);
      effects.push({ kind: 'exhaustion', duration: d ? tunableValues(perk, d[1]) : null, when: ctxPlain });
    }

    // --- terror radius -----------------------------------------------------
    const trRe = /terror radius is \{Tunable\.[^.}]+\.([^}]+)\}(%|m) (larger|smaller)/i.exec(text);
    if (trRe) {
      const values = tunableValues(perk, trRe[1]);
      if (values) effects.push({ kind: 'terror-radius', values, unit: trRe[2], sign: /larger/i.test(trRe[3]) ? 1 : -1, when: ctxPlain });
    }

    // --- generator blocking --------------------------------------------------
    if (role === 'killer') {
      const blk = /\bblocked for \{Tunable\.[^.}]+\.([^}]+)\}s/i.exec(text);
      if (blk && /generator/i.test(ctxPlain)) {
        const values = tunableValues(perk, blk[1]);
        if (values) effects.push({ kind: 'gen-block', values, scaling: scalingOf(text, c.header, blk[1], perk, blk.index, blk.index + blk[0].length), when: ctxPlain });
      }
    }

    // --- aura reading ------------------------------------------------------
    if (/\bsee[s]? (the|their|your|that|its|each other's|a survivor's|the killer's)[^.]*\bauras?\b/i.test(plain(text))) {
      const p = plain(text).toLowerCase();
      const of = /killer's aura|aura of the killer/.test(p) ? 'killer'
        : /aura[s]? of (all |other |the |injured |downed )*survivors|survivor's aura|their aura|each other's aura|your aura/.test(p) ? 'survivors'
        : /generator/.test(p) ? 'generators' : /totem/.test(p) ? 'totems' : /chest|item/.test(p) ? 'items' : /pallet|window/.test(p) ? 'pallets' : /hook/.test(p) ? 'hooks' : 'other';
      const who = /\b(other )?survivors see\b|\bthey see\b|\bsees\b/.test(p) ? (role === 'killer' ? 'survivors' : 'allies') : 'self';
      const d = /\bfor \{Tunable\.[^.}]+\.([^}]+)\}s/i.exec(text);
      effects.push({ kind: 'aura', of, who, duration: d ? tunableValues(perk, d[1]) : null, when: ctxPlain });
    }
  }

  // "all above actions are additionally X% slower" (Thanatophobia-style)
  const prior = effects.filter((e) => e.kind === 'action' && e.action !== '__above__');
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    if (e.kind === 'action' && e.action === '__above__') {
      const acts = [...new Set(prior.map((p) => p.action))];
      effects.splice(i, 1, ...acts.map((action) => ({ ...e, action, bonus: true, target: prior[0]?.target || e.target, scaling: null })));
    }
  }

  // --- structural flags -----------------------------------------------------
  const name = perk.name || '';
  const flags = {
    hex: /^Hex:/i.test(name),
    scourge: /^Scourge Hook:/i.test(name),
    boon: /^Boon:/i.test(name),
    teamwork: /^Teamwork:/i.test(name),
    invocation: /^Invocation:/i.test(name),
    obsession: /\bobsession\b/.test(whole),
    tokens: /\btokens?\b/.test(whole),
    endgame: /when all generators are completed|exit gates? (are|is) powered|when the exit gates/.test(whole),
    scream: /\bscreams?\b/.test(whole),
    basement: /\bbasement\b/.test(whole),
    locker: /\blockers?\b/.test(whole),
    chest: /\bchests?\b/.test(whole),
    totem: /\btotems?\b/.test(whole),
    stun: /\bstun/.test(whole),
    blind: /\bblind(ed|s)?\b|flashlight|flashbang/.test(whole),
    wiggle: /\bwiggl/.test(whole),
    slug: /\bdowned\b|\bdying\b|\brecover/.test(whole),
    unhook: /\bunhook/.test(whole),
    skillcheck: /skill checks?/.test(whole),
    pallet: /\bpallets?\b/.test(whole),
    vault: /\bvault/.test(whole),
    genKick: /whenever you damage a generator|when you damage a generator/.test(whole),
    hookTrigger: /whenever you hook|after hooking|each time you hook|is hooked/.test(whole),
    heal: /\bheal/.test(whole),
    item: /med-kit|toolbox|flashlight|\bitem\b/.test(whole),
  };
  const keywords = [...new Set([...template.matchAll(/\{Keyword\.([^}]+)\}/g)].map((x) => x[1].toLowerCase()))];
  return { effects, flags, keywords };
}
