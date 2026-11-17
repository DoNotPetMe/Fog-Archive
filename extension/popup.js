const send = (type, extra = {}) => new Promise((r) => chrome.runtime.sendMessage({ type, ...extra }, (x) => r(x || { ok: false })));
const LABEL = { description: 'description', title: 'title', 'youtube-ai': "YouTube's AI", 'creator-comment': "creator's comment", comment: 'viewer comment (risky)' };
const ago = (iso) => { if (!iso) return 'never'; const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

async function render() {
  const r = await send('get-data');
  if (!r.ok) return;
  const { builds, state, settings } = r.data;
  const st = document.getElementById('status');
  st.textContent = `${settings.channels} channels · checked ${ago(state?.lastCheck)} · every ${settings.intervalMinutes} min`;
  if (state?.error) { st.textContent += ` — ${state.error}`; st.className = 'err'; } else if (state?.failed?.length) { st.textContent += ` — ${state.failed.length} channel(s) failed`; }
  // always shown: the live archive unless Options points somewhere else
  if (settings.siteUrl) document.getElementById('open').href = `${settings.siteUrl}#/builds`;
  const list = document.getElementById('list');
  list.textContent = '';
  if (!builds.length) { list.innerHTML = '<p class="muted">No builds found yet.</p>'; return; }
  for (const b of builds.slice(0, 12)) {
    const c = document.createElement('a');
    c.className = 'card'; c.style.textDecoration = 'none'; c.style.color = 'inherit';
    c.href = `https://www.youtube.com/watch?v=${encodeURIComponent(b.video)}`; c.target = '_blank';
    const t = document.createElement('b'); t.textContent = b.title;
    const p = document.createElement('div'); p.textContent = (b.perkNames || []).join(' · ');
    const s = document.createElement('small'); s.innerHTML = '';
    const src = document.createElement('span'); src.className = `src ${b.confidence}`; src.textContent = `${LABEL[b.foundIn] || b.foundIn}`;
    s.append(src, document.createTextNode(` · ${b.channel} · ${b.found}`));
    c.append(t, p, s);
    list.append(c);
  }
}
document.getElementById('check').addEventListener('click', async (e) => {
  e.target.disabled = true; e.target.textContent = 'Checking…';
  await send('check-now');
  e.target.disabled = false; e.target.textContent = 'Check channels now';
  render();
});
send('seen-finds');
render();
