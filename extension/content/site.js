// Fog Archive Scout — bridge on the archive page.
// Runs only on pages that identify themselves as a Fog Archive, and only
// passes data to that page's own origin.
(() => {
  if (!document.querySelector('meta[name="fog-archive"]')) return;
  const ORIGIN = location.origin;
  const send = (type, extra = {}) => new Promise((resolve) => {
    try { chrome.runtime.sendMessage({ type, ...extra }, (r) => resolve(chrome.runtime.lastError ? null : r)); } catch { resolve(null); }
  });
  async function push() {
    const r = await send('get-data');
    if (!r?.ok) return;
    const { builds, videos, settings } = r.data;
    window.postMessage({ source: 'fog-archive-ext', type: 'data', builds, videos, settings }, ORIGIN);
  }
  send('site-seen', { url: location.href });
  window.addEventListener('message', async (e) => {
    if (e.source !== window || e.origin !== ORIGIN) return;
    const d = e.data;
    if (!d || d.source !== 'fog-archive') return;
    if (d.type === 'hello') { push(); send('seen-finds'); }
    if (d.type === 'check-now') { await send('check-now'); push(); }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.builds || changes.videos || changes.state)) push();
  });
})();
