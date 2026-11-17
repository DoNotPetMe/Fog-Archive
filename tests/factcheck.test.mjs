// Regression tests for the write-up fact-checker, run against the live perk data in site/api/v1.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { checkWriteup, fillValues, perkNameIndex } from '../site/js/engine/factcheck.mjs';

const perks = JSON.parse(fs.readFileSync(new URL('../site/api/v1/perks.json', import.meta.url))).perks;
const killers = JSON.parse(fs.readFileSync(new URL('../site/api/v1/characters.json', import.meta.url))).characters.filter((c) => c.role === 'killer');
const rules = JSON.parse(fs.readFileSync(new URL('../data/rules.json', import.meta.url)));
const perkById = new Map(perks.map((p) => [p.id, p]));
const byName = perkNameIndex(perks);
const ctx = { perkById, allPerks: perks, constants: rules.constants, killers };
const id = (n) => byName.get(n.toLowerCase().replace(/[^a-z0-9]/g, '')).id;
const LEGION = ['Surge', 'Coup de Grace', 'Batteries Included', 'Turn Back The Clock'].map(id);
const check = (fields, ids = LEGION) => checkWriteup({ role: 'killer', perks: ids, alts: {}, tips: [], ...fields }, ctx);
const rules_ = (r) => r.issues.filter((i) => !i.waived && i.severity !== 'info').map((i) => i.rule);

test('the original wrong Legion summary is rejected', () => {
  const r = check({ summary: 'Legion snowball build: every down and hook blows up generators while completed gens make you faster and your lunges longer.' });
  assert.equal(r.status, 'flagged');
  const got = rules_(r);
  assert.ok(got.includes('manual'), 'Turn Back the Clock is manual');
  assert.ok(got.includes('basic-attack'), 'Surge needs basic-attack downs');
  assert.ok(got.includes('single-target'), 'Turn Back the Clock hits one generator');
  assert.ok(got.includes('range'), 'Batteries Included / Surge have a range');
});

test('the original wrong Coup de Grace tip is rejected', () => {
  const r = check({ tips: ['Save Coup de Grâce Tokens for lunges that would otherwise fall just short at pallets and windows.'] });
  assert.ok(rules_(r).includes('auto-tokens'));
});

test('a claim no perk supports is rejected (hooks with Pain Resonance-style wording)', () => {
  const ids = ['Surge', 'Coup de Grace', 'Batteries Included', 'Bamboozle'].map(id);
  const r = check({ summary: 'Every hook blows up the generator with the most progress.' }, ids);
  assert.ok(rules_(r).includes('unsupported-trigger'));
});

test('a "first time only" perk claimed for every hook is rejected (Pain Resonance)', () => {
  const ids = ['Scourge Hook: Pain Resonance', 'Scourge Hook: Monstrous Shrine', 'Agitation', 'Iron Grasp'].map(id);
  const r = check({ details: 'Basement hooks always count as Scourge Hooks, so each trip can trigger Pain Resonance, and Monstrous Shrine speeds up regression on unattended generators.' }, ids);
  assert.ok(rules_(r).includes('first-time'));
});

test('a claim credited to the wrong perk is rejected', () => {
  const r = check({ summary: 'Batteries Included makes your lunges longer after each completed generator.' });
  assert.ok(rules_(r).includes('misattributed') || rules_(r).includes('unsupported-effect'));
});

test('a correct multi-perk sentence passes (Plaything Oblivious, Third Seal Blindness)', () => {
  const ids = ['Hex: Plaything', 'Hex: The Third Seal', 'Hex: Undying', 'Make Your Choice'].map(id);
  const r = check({ summary: 'Third Seal gives Blindness to Survivors you hit, and the first time you hook each Survivor Plaything makes them Oblivious.' }, ids);
  assert.deepEqual(rules_(r), []);
});

test('units come from the perk text: a % value written as % passes', () => {
  const ids = ['Distressing', 'Coulrophobia', 'Unnerving Presence', 'Bamboozle'].map(id);
  const r = check({ summary: fillValues('Distressing makes your Terror Radius {{Distressing|terrorradiusincreasesize}}% larger.', byName).text }, ids);
  assert.ok(!rules_(r).includes('number'));
});

test('a perk name is not a trigger (Pop Goes the Weasel)', () => {
  const ids = ['Pop Goes the Weasel', 'Surge', 'Eruption', 'Bamboozle'].map(id);
  const r = check({ summary: 'After a hook, Pop Goes the Weasel makes your next kick explode the generator.' }, ids);
  assert.ok(!rules_(r).includes('unsupported-trigger'));
});

test('hard-coded numbers that are not live values are rejected', () => {
  const r = check({ summary: 'Basic-attack downs explode generators within 40 m.' });
  assert.ok(rules_(r).includes('number'));
});

test('status effects must come from a perk in the build', () => {
  const r = check({ summary: 'Downed Survivors are left Exposed for the rest of the chase.' });
  assert.ok(rules_(r).includes('unsupported-effect'));
});

test('an accurate write-up with live value tokens passes', () => {
  const t = (s) => fillValues(s, byName).text;
  const r = check({
    summary: t('Basic-attack downs explode every generator within {{Surge|affecteddistance}} m, and after each hook you can press the ability button to explode one generator you can see within {{Turn Back The Clock|range}} m.'),
    details: t('Completed generators pay off twice: within {{Batteries Included|requireddistance}} m of one you gain {{Batteries Included|haste%}}% Haste, and each one earns {{Coup de Grace|tokensgainedpergenerator}} Coup de Grâce Tokens that make your next lunges {{Coup de Grace|lungeextraduration%}}% longer.'),
  });
  assert.deepEqual(rules_(r), []);
  assert.equal(r.status, 'verified');
});

test('value tokens resolve to live tier III values and report missing keys', () => {
  const r = fillValues('{{Surge|affecteddistance}} m, {{Surge|regression%|all}}%, {{Surge|nope}}', byName);
  assert.match(r.text, /^\d+ m, \d+\/\d+\/\d+%, \?$/);
  assert.deepEqual(r.missing, ['Surge|nope']);
});

test('a reviewed stamp goes stale when a perk changes', () => {
  const ok = check({ summary: 'Coup de Grâce makes lunges longer.', requireStamp: true });
  assert.equal(ok.status, 'stale');
  const stamped = check({ summary: 'Coup de Grâce makes lunges longer.', requireStamp: true, checked: { perks: ok.hashes } });
  assert.equal(stamped.status, 'verified');
  const changed = check({ summary: 'Coup de Grâce makes lunges longer.', requireStamp: true, checked: { perks: { ...ok.hashes, [LEGION[0]]: 'old' } } });
  assert.equal(changed.status, 'stale');
});
