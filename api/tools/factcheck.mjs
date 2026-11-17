#!/usr/bin/env node
// Fact-check every curated build write-up against the live perk data.
//
//   npm run check                      report (exit code 1 if anything is flagged or stale)
//   npm run check -- --json            machine-readable report
//   npm run check -- --only "Title"    check one build
//   npm run check -- --stamp "Title"   mark a build as reviewed (only if it passes every check)
//   npm run check -- --stamp-passing   mark every passing build as reviewed
//   npm run check -- --file other.json check a different file with the same shape
//
// "Reviewed" stores a hash of each perk's current text and values. When a patch
// changes one of those perks, the write-up goes stale and the site hides it
// again until it is re-checked and re-stamped.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkWriteup, fillValues, perkNameIndex } from '../../site/js/engine/factcheck.mjs';
import { normName } from '../../site/js/engine/text.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const read = async (p) => JSON.parse(await fs.readFile(path.join(ROOT, p), 'utf8'));
const perks = (await read('site/api/v1/perks.json')).perks;
const meta = await read('site/api/v1/meta.json').catch(() => ({}));
const killers = (await read('site/api/v1/characters.json')).characters.filter((c) => c.role === 'killer');
const rules = await read('data/rules.json');
const file = opt('--file') ? path.resolve(opt('--file')) : path.join(ROOT, 'data/curated/builds.json');
const curated = JSON.parse(await fs.readFile(file, 'utf8'));

const byName = perkNameIndex(perks);
const ctx = { perkById: new Map(perks.map((p) => [p.id, p])), allPerks: perks, constants: rules.constants, killers };

const results = [];
for (const [index, b] of curated.builds.entries()) {
  if (opt('--only') && b.title !== opt('--only')) continue;
  const ids = (b.perks || []).map((n) => byName.get(normName(n))?.id);
  if (ids.some((x) => !x)) { results.push({ index, title: b.title, status: 'error', issues: [{ severity: 'error', field: 'perks', message: `unknown perk(s): ${b.perks.filter((n, i) => !ids[i]).join(', ')}` }] }); continue; }
  const missing = [];
  const fill = (t) => { const r = fillValues(t, byName); missing.push(...r.missing); return r.text; };
  const alts = {};
  (b.alts || []).forEach((list, i) => { alts[ids[i]] = (list || []).map((n) => byName.get(normName(n))?.id).filter(Boolean); });
  const r = checkWriteup({ role: b.role, perks: ids, alts, summary: fill(b.summary), details: fill(b.details), tips: (b.tips || []).map(fill), checked: b.checked, requireStamp: true }, ctx);
  for (const m of missing) r.issues.push({ severity: 'error', field: 'value token', rule: 'token', message: `{{${m}}} is not a live value (check the perk name and key in perks.json)` });
  if (missing.length && r.status !== 'flagged') r.status = 'flagged';
  results.push({ index, title: b.title, status: r.status, issues: r.issues, hashes: r.hashes });
}

// stamping: record that a human/AI review confirmed a passing write-up against the current perk text
const toStamp = flag('--stamp-passing') ? results.filter((r) => r.status !== 'flagged' && r.status !== 'error') : opt('--stamp') ? results.filter((r) => r.title === opt('--stamp')) : [];
let stamped = 0;
for (const r of toStamp) {
  if (r.status === 'flagged' || r.status === 'error') { console.error(`not stamping "${r.title}": it still fails checks`); continue; }
  const b = curated.builds[r.index];
  b.checked = { patch: meta.gameVersion || null, date: new Date().toISOString().slice(0, 10), perks: r.hashes, accepted: (b.checked?.accepted || []).filter((a) => a.reason) };
  r.status = 'verified';
  stamped++;
}
if (stamped) await fs.writeFile(file, JSON.stringify(curated, null, 1));

if (flag('--json')) {
  console.log(JSON.stringify(results.map(({ hashes, ...r }) => r), null, 1));
} else {
  const bad = results.filter((r) => r.status !== 'verified' && r.status !== 'none');
  for (const r of bad) {
    console.log(`\n[${r.status.toUpperCase()}] ${r.title}`);
    for (const i of r.issues.filter((x) => !x.waived && x.severity !== 'info')) console.log(`   ${i.severity.padEnd(5)} ${i.field}: ${i.message}${i.clause ? `\n         “${i.clause}”` : ''}`);
  }
  const count = (s) => results.filter((r) => r.status === s).length;
  console.log(`\n${results.length} write-ups: ${count('verified')} verified, ${count('stale')} awaiting review, ${count('flagged') + count('error')} flagged${stamped ? `, ${stamped} stamped now` : ''}`);
}
process.exitCode = results.some((r) => r.status === 'flagged' || r.status === 'error' || r.status === 'stale') ? 1 : 0;
