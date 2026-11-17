// Build detection from video text, run against the live perk list.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makePerkIndex, detectVideoBuilds, titleCategories } from '../site/js/engine/detect.mjs';

const perks = JSON.parse(fs.readFileSync(new URL('../site/api/v1/perks.json', import.meta.url))).perks;
const killers = JSON.parse(fs.readFileSync(new URL('../site/api/v1/characters.json', import.meta.url))).characters.filter((c) => c.role === 'killer');
const index = makePerkIndex(perks);
const names = (b) => b.perks.map((p) => p.name);

test('labelled build lines in a description, add-ons ignored', () => {
  const r = detectVideoBuilds({ title: 'I Made DBD Basement INESCAPABLE', description: 'THE BUILDS\nBasement Trapper - Agitation, Scourge Hook: Monstrous Shrine, Make Your Choice, Hex: Crowd Control + Iridescent Stone and Trapper Sack' }, index, killers);
  assert.equal(r.length, 1);
  assert.equal(r[0].killer?.name, 'The Trapper');
  assert.equal(r[0].from, 'description');
  assert.deepEqual(names(r[0]), ['Agitation', 'Scourge Hook: Monstrous Shrine', 'Make your Choice', 'Hex: Crowd Control']);
});

test('one perk per line under a heading', () => {
  const r = detectVideoBuilds({ title: 'x', description: 'THE BUILD:\nSurge\nCoup de Grace\nBatteries Included\nTurn Back the Clock\n\nTwitch: ...' }, index, killers);
  assert.equal(r.length, 1);
  assert.equal(r[0].perks.length, 4);
});

test('renamed perks and small typos still resolve', () => {
  const r = detectVideoBuilds({ title: 'x', description: 'Build: Deadlock, Barbecue & Chilli, Residiual Manifest, Pop Goes the Weasel' }, index, killers);
  assert.equal(r.length, 0, 'mixed killer and survivor perks are not a build');
  const k = detectVideoBuilds({ title: 'x', description: 'Build: Deadlock, Barbecue & Chilli, Pain Resonance, Pop Goes the Weasel' }, index, killers);
  assert.equal(k.length, 1);
});

test('four perks named in a title', () => {
  const r = detectVideoBuilds({ title: 'Surge + Coup de Grace + Batteries Included + Turn Back the Clock on Legion', description: '' }, index, killers);
  assert.equal(r.length, 1);
  assert.equal(r[0].from, 'title');
});

test('chatter that mentions perks is not a build', () => {
  const r = detectVideoBuilds({ title: 'x', description: 'Today I tried Surge and it was fun. Lithe is great too.' }, index, killers);
  assert.equal(r.length, 0);
});

test('categories only come from the creator\'s literal words', () => {
  assert.deepEqual(titleCategories('Abusing The Perk Interaction EVERYONE Forgot About'), []);
  assert.deepEqual(titleCategories('The MOST TOXIC build'), ['toxic']);
});
