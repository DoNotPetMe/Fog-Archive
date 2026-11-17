const send = (type, extra = {}) => new Promise((r) => chrome.runtime.sendMessage({ type, ...extra }, (x) => r(x || { ok: false, error: 'no answer' })));
const $ = (id) => document.getElementById(id);
const DEFAULT_SOURCES = { title: true, description: true, askAI: true, comments: true };
let s;

function msg(text, bad) { $('msg').textContent = text; $('msg').className = bad ? 'err' : 'muted'; }

async function load() {
  const { settings } = await chrome.storage.local.get('settings');
  s = { ...(settings || {}) };
  s.sources = { ...DEFAULT_SOURCES, ...(s.sources || {}) };
  s.channels = s.channels || [];
  $('siteUrl').value = s.siteUrl || '';
  $('interval').value = String(s.intervalMinutes || 180);
  $('notify').checked = s.notify !== false;
  $('keywords').value = (s.keywords || []).join(', ');
  for (const k of Object.keys(DEFAULT_SOURCES)) $(`src-${k}`).checked = !!s.sources[k];
  const { state } = await chrome.storage.local.get('state');
  $('last').textContent = state?.lastCheck ? `Last checked ${new Date(state.lastCheck).toLocaleString()}${state.error ? ` — ${state.error}` : ''}` : 'Not checked yet';
  renderChannels();
}

function renderChannels() {
  const box = $('channels');
  box.textContent = '';
  for (const c of s.channels) {
    const row = document.createElement('div');
    row.className = 'card';
    const a = document.createElement('a');
    a.href = `https://www.youtube.com/channel/${encodeURIComponent(c.id)}`;
    a.target = '_blank';
    a.textContent = c.name;
    a.style.color = 'inherit';
    const id = document.createElement('small');
    id.textContent = c.id;
    const left = document.createElement('div');
    left.append(a, document.createElement('br'), id);
    const rm = document.createElement('button');
    rm.textContent = 'Remove';
    rm.addEventListener('click', async () => { s.channels = s.channels.filter((x) => x.id !== c.id); await save(); renderChannels(); });
    row.append(left, rm);
    box.append(row);
  }
}

async function save() {
  await chrome.storage.local.set({ settings: s });
  await send('reschedule');
}

$('siteUrl').addEventListener('change', async (e) => {
  let v = e.target.value.trim();
  if (v && !/\/$/.test(v)) v += '/';
  if (v) {
    let u;
    try { u = new URL(v); } catch { return msg('That is not a valid address', true); }
    // custom domains need permission so the extension can read the archive's perk list
    if (u.protocol === 'https:' && !/\.github\.io$/.test(u.hostname)) {
      const ok = await chrome.permissions.request({ origins: [`${u.origin}/*`] });
      if (!ok) return msg('Permission to read that site was not granted', true);
    }
  }
  s.siteUrl = v;
  e.target.value = v;
  await save();
  msg('Saved');
});
$('interval').addEventListener('change', async (e) => { s.intervalMinutes = Number(e.target.value); await save(); msg('Saved: the next check is rescheduled'); });
$('notify').addEventListener('change', async (e) => { s.notify = e.target.checked; await save(); });
$('keywords').addEventListener('change', async (e) => { s.keywords = e.target.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 30); await save(); msg('Saved'); });
for (const k of Object.keys(DEFAULT_SOURCES)) $(`src-${k}`).addEventListener('change', async (e) => { s.sources[k] = e.target.checked; await save(); });

$('addBtn').addEventListener('click', async () => {
  const input = $('add').value.trim();
  if (!input) return;
  msg('Looking up the channel…');
  const r = await send('resolve-channel', { input });
  if (!r.ok) return msg(r.error, true);
  if (s.channels.some((c) => c.id === r.data.id)) return msg(`${r.data.name} is already on the list`);
  s.channels.push({ id: r.data.id, name: r.data.name });
  await save();
  renderChannels();
  $('add').value = '';
  msg(`Added ${r.data.name}${r.data.latest ? ` (latest video: ${r.data.latest})` : ''}`);
});

$('check').addEventListener('click', async (e) => {
  e.target.disabled = true;
  msg('Checking channels…');
  const r = await send('check-now');
  e.target.disabled = false;
  if (!r.ok || r.data?.error) return msg(r.error || r.data.error, true);
  msg(`Checked ${r.data.channelsRead} channels: ${r.data.newBuilds} new builds${r.data.failed?.length ? `, ${r.data.failed.length} failed` : ''}`);
  load();
});

$('export').addEventListener('click', async () => {
  const { builds = [], perkCache } = await chrome.storage.local.get(['builds', 'perkCache']);
  const perk = new Map((perkCache?.perks || []).map((p) => [p.id, p]));
  const killer = new Map((perkCache?.killers || []).map((k) => [k.id, k.name]));
  const out = {
    builds: builds.map((b) => ({
      title: b.title,
      role: perk.get(b.perks[0])?.role || 'killer',
      killer: killer.get(b.killer) || null,
      perks: b.perks.map((id) => perk.get(id)?.name || id),
      categories: (b.tags || []).filter((t) => ['creator', 'toxic', 'meta', 'fun'].includes(t)),
      tags: [], summary: '', details: '', tips: [],
      source: { name: b.channel, url: `https://www.youtube.com/watch?v=${b.video}`, date: (b.published || b.found || '').slice(0, 7) || null },
      video: { id: b.video },
      foundIn: b.foundIn, confidence: b.confidence,
    })),
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  a.download = `fog-scout-builds-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('clear').addEventListener('click', async () => {
  if (!confirm('Remove every build and video the extension has found? Your settings and channels stay.')) return;
  await send('clear-finds');
  msg('Cleared');
});
load();
