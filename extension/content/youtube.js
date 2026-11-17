// Fog Archive Scout — panel on YouTube watch pages.
//
// Finds the build used in the video you are watching, in this order:
//   1. title + description (automatic; written by the creator)
//   2. YouTube's "Ask" AI (when you click it; only on videos/accounts that offer it)
//   3. comments (last resort; the creator's / pinned comments first, viewers' marked risky)
// Found builds are saved in this browser and show up in your Fog Archive.
(() => {
  const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
  const LABEL = { description: 'Video description', title: 'Video title', 'youtube-ai': "YouTube's AI answer", 'creator-comment': "Creator's / pinned comment", comment: 'Viewer comment (risky)' };
  let current = null; // { id, video, results }
  let root = null;

  const send = (type, extra = {}) => new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type, ...extra }, (r) => resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : r || { ok: false, error: 'no answer' }));
    } catch (err) { resolve({ ok: false, error: err.message }); }
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitFor(fn, ms = 8000, step = 250) {
    for (let t = 0; t < ms; t += step) { const v = fn(); if (v) return v; await sleep(step); }
    return null;
  }
  const videoId = () => {
    const u = new URL(location.href);
    const id = u.pathname === '/watch' ? u.searchParams.get('v') : (/^\/shorts\/([A-Za-z0-9_-]{11})/.exec(u.pathname) || [])[1];
    return VIDEO_ID.test(id || '') ? id : null;
  };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

  // ------------------------------------------------------------------ UI
  function ensureButton() {
    const id = videoId();
    let btn = document.getElementById('fog-scout-btn');
    if (!id) { btn?.remove(); root?.remove(); root = null; return; }
    if (!btn) {
      btn = el('button', '', 'Find build');
      btn.id = 'fog-scout-btn';
      btn.title = 'Fog Archive Scout: find the perk build used in this video';
      btn.addEventListener('click', () => (root ? closePanel() : openPanel()));
      document.body.appendChild(btn);
    }
    if (current && current.id !== id) { current = null; if (root) openPanel(); }
  }

  function closePanel() { root?.remove(); root = null; }

  function status(text, kind = '') {
    if (!root) return;
    const s = root.querySelector('.fog-status');
    s.textContent = text;
    s.dataset.kind = kind;
  }

  function renderResults() {
    const list = root.querySelector('.fog-results');
    list.textContent = '';
    for (const b of current?.results || []) {
      const item = el('div', `fog-build fog-${b.confidence}`);
      const head = el('div', 'fog-build-head');
      head.append(el('b', '', b.title || 'Build'), el('span', `fog-src fog-${b.confidence}`, `${LABEL[b.foundIn] || b.foundIn}${b.risk ? ` — ${b.risk}` : ''}`));
      const perks = el('ul', 'fog-perks');
      for (const n of b.perkNames || []) perks.append(el('li', '', n));
      const save = el('button', 'fog-save', b.saved ? 'Saved' : 'Save to archive');
      save.disabled = !!b.saved;
      save.addEventListener('click', async () => {
        save.disabled = true;
        const r = await send('save-build', { build: b });
        if (r.ok) { b.saved = true; save.textContent = 'Saved'; } else { save.disabled = false; status(`Could not save: ${r.error}`, 'bad'); }
      });
      item.append(head, perks, save);
      list.append(item);
    }
  }

  function addResults(found) {
    const have = new Map((current.results || []).map((b) => [b.id, b]));
    for (const b of found) if (!have.has(b.id)) have.set(b.id, b);
    current.results = [...have.values()];
    renderResults();
  }

  async function openPanel() {
    const id = videoId();
    if (!id) return;
    root?.remove();
    root = el('div');
    root.id = 'fog-scout';
    const head = el('div', 'fog-head');
    const close = el('button', 'fog-close', '×');
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', closePanel);
    head.append(el('b', '', 'Fog Archive Scout'), close);
    const actions = el('div', 'fog-actions');
    const ask = el('button', '', "Ask YouTube's AI");
    const read = el('button', 'fog-ghost', 'Read Ask answer');
    const comments = el('button', 'fog-ghost', 'Check comments (risky)');
    ask.addEventListener('click', askAI);
    read.addEventListener('click', () => readAskAnswer(false));
    comments.addEventListener('click', checkComments);
    actions.append(ask, read, comments);
    root.append(head, el('div', 'fog-status', ''), el('div', 'fog-results'), actions);
    document.body.appendChild(root);

    if (current?.id === id) { renderResults(); status(current.results.length ? 'Builds found for this video:' : 'Nothing found in the title or description.'); return; }
    current = { id, video: { id, title: document.title.replace(/\s*-\s*YouTube$/, '') }, results: [] };
    status('Reading the title and description…');
    const r = await send('scan-video', { id });
    if (!root || current?.id !== id) return;
    if (!r.ok) { status(r.error, 'bad'); return; }
    current.video = r.data.video;
    addResults(r.data.found);
    status(r.data.found.length ? 'Found in the creator’s own words:' : 'No build in the title or description. Try YouTube’s AI, then comments.', r.data.found.length ? 'good' : '');
  }

  // --------------------------------------------------------- YouTube's AI
  const QUESTION = 'Which 4 perks are in the build used in this video? Reply with only the exact perk names, separated by commas.';
  const askPanel = () => document.querySelector('ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"][target-id*="ask" i], ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"][target-id*="chat" i], ytd-engagement-panel-section-list-renderer[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"][target-id*="youchat" i]');

  async function askAI() {
    if (!current) return;
    const btn = [...document.querySelectorAll('ytd-watch-metadata button, #actions button, yt-button-view-model button, ytd-button-renderer button')]
      .find((b) => /^ask\b/i.test((b.getAttribute('aria-label') || b.textContent || '').trim()));
    if (!btn) {
      const signedOut = !!document.querySelector('a[href*="ServiceLogin"], ytd-masthead a[aria-label*="Sign in" i]');
      status(signedOut ? "YouTube's Ask button only appears when you are signed in to YouTube." : "YouTube's Ask feature is not offered on this video for your account.", 'bad');
      return;
    }
    btn.click();
    const input = await waitFor(() => {
      const p = askPanel() || document;
      return p.querySelector('textarea, [contenteditable="true"][role="textbox"], input[type="text"][placeholder]');
    });
    if (!input) { status(`The Ask panel opened but its question box was not found. Ask it: "${QUESTION}" then press "Read Ask answer".`); return; }
    input.focus();
    if ('value' in input) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
      setter ? setter.call(input, QUESTION) : (input.value = QUESTION);
    } else input.textContent = QUESTION;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: QUESTION }));
    await sleep(300);
    const sendBtn = (askPanel() || document).querySelector('button[aria-label*="send" i], button[aria-label*="submit" i]');
    if (sendBtn && !sendBtn.disabled) sendBtn.click();
    else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    status("Waiting for YouTube's AI to answer…");
    await readAskAnswer(true);
  }

  /** Read the Ask panel's text once it stops changing, and look for four perks in it. */
  async function readAskAnswer(waiting) {
    const p = askPanel();
    if (!p) { status('Open YouTube’s Ask panel first (the "Ask" button under the video).', 'bad'); return; }
    let last = '', stable = 0;
    for (let t = 0; t < (waiting ? 45000 : 1); t += 1000) {
      const txt = p.innerText || '';
      if (txt === last && txt.length > QUESTION.length + 20) { if (++stable >= 3) break; } else stable = 0;
      last = txt;
      await sleep(1000);
    }
    const text = (p.innerText || '').split(QUESTION).pop();
    const r = await send('detect-text', { texts: [{ text }], from: 'youtube-ai', video: current.video });
    if (!r.ok) { status(r.error, 'bad'); return; }
    addResults(r.data);
    status(r.data.length ? "Found in YouTube's AI answer (AI can be wrong — check the video):" : "YouTube's AI answer did not name four perks.", r.data.length ? '' : 'bad');
  }

  // -------------------------------------------------------------- comments
  async function checkComments() {
    if (!current) return;
    let threads = document.querySelectorAll('ytd-comment-thread-renderer');
    if (!threads.length) {
      const y = scrollY;
      document.querySelector('#comments')?.scrollIntoView();
      status('Loading comments…');
      await waitFor(() => document.querySelectorAll('ytd-comment-thread-renderer').length, 6000);
      scrollTo({ top: y });
      threads = document.querySelectorAll('ytd-comment-thread-renderer');
    }
    if (!threads.length) { status('Comments did not load (they may be turned off).', 'bad'); return; }
    const texts = [...threads].slice(0, 200).map((t) => {
      const text = t.querySelector('#content-text')?.innerText || '';
      const pinned = !!t.querySelector('ytd-pinned-comment-badge-renderer, #pinned-comment-badge ytd-pinned-comment-badge-renderer');
      const creator = !!t.querySelector('ytd-author-comment-badge-renderer, #author-text.creator, [creator]');
      return { text, creator: pinned || creator };
    }).filter((x) => x.text);
    const r = await send('detect-text', { texts, from: 'comment', video: current.video });
    if (!r.ok) { status(r.error, 'bad'); return; }
    addResults(r.data);
    status(r.data.length ? `Checked ${texts.length} comments. Comments are the least reliable source — verify before saving.` : `No four-perk build in ${texts.length} loaded comments.`, r.data.length ? '' : 'bad');
  }

  // ------------------------------------------------------- page changes
  document.addEventListener('yt-navigate-finish', ensureButton);
  addEventListener('popstate', ensureButton);
  let lastHref = location.href;
  setInterval(() => { if (location.href !== lastHref) { lastHref = location.href; ensureButton(); } }, 1500);
  ensureButton();
})();
