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
  const dbdCache = new Map(); // video id -> true / false
  let checking = null;

  /** Is the video on screen about Dead by Daylight? Buzzwords in its title, channel and description. */
  async function isDbdVideo(id) {
    if (dbdCache.has(id)) return dbdCache.get(id);
    // the page swaps its text in after navigating; wait until the title belongs to this video
    await waitFor(() => document.querySelector('ytd-watch-metadata h1')?.textContent.trim(), 6000);
    const title = document.querySelector('ytd-watch-metadata h1')?.textContent.trim() || document.title.replace(/\s*-\s*YouTube$/, '');
    const channel = document.querySelector('ytd-watch-metadata ytd-channel-name a, #owner ytd-channel-name a')?.textContent.trim() || '';
    const description = (document.querySelector('ytd-watch-metadata #description-inline-expander, #description')?.textContent || '').slice(0, 3000);
    const r = await send('is-dbd', { title, channel, description });
    const yes = !!(r.ok && r.data?.dbd);
    if (videoId() === id) dbdCache.set(id, yes);
    return yes;
  }

  async function ensureButton() {
    const id = videoId();
    let btn = document.getElementById('fog-scout-btn');
    if (!id) { btn?.remove(); root?.remove(); root = null; return; }
    if (!dbdCache.has(id)) {
      btn?.remove(); root?.remove(); root = null;
      if (checking === id) return;
      checking = id;
      const yes = await isDbdVideo(id);
      checking = null;
      if (!yes || videoId() !== id) return;
      btn = null;
    } else if (!dbdCache.get(id)) { btn?.remove(); root?.remove(); root = null; return; }
    btn = document.getElementById('fog-scout-btn');
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
  const QUESTION = "Which perk builds are used in this video? If the video has more than one build, list them all, one build per line, starting with the build's name if it has one (Name: perk, perk, perk, perk). If a build has no name, just list its four perks separated by commas. Use the exact perk names and nothing else.";
  // YouTube's own search bar and top bar: never typed into, whatever happens
  const SEARCH_UI = 'ytd-masthead, #masthead, #masthead-container, ytd-searchbox, yt-searchbox, #search, form#search-form, #search-form';
  const isSearchUi = (n) => !!n.closest(SEARCH_UI) || n.getAttribute?.('name') === 'search_query';
  const PANEL = 'ytd-engagement-panel-section-list-renderer';
  const expandedPanels = () => [...document.querySelectorAll(`${PANEL}[visibility="ENGAGEMENT_PANEL_VISIBILITY_EXPANDED"]`)].filter((p) => !isSearchUi(p));
  let askPanelEl = null;

  /** The open Ask panel: the one we saw open after clicking "Ask", or an open panel that looks like a chat. */
  function askPanel() {
    if (askPanelEl?.isConnected && askPanelEl.getAttribute('visibility') === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED') return askPanelEl;
    return expandedPanels().find((p) => /ask|chat|conversation/i.test(p.getAttribute('target-id') || '')) || null;
  }
  const textBoxIn = (panel) => [...panel.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]')]
    .find((n) => !isSearchUi(n) && n.offsetParent !== null);

  async function copyQuestion() {
    try { await navigator.clipboard.writeText(QUESTION); return true; } catch { return false; }
  }

  async function askAI() {
    if (!current) return;
    const btn = [...document.querySelectorAll('ytd-watch-metadata button, #actions button')]
      .filter((b) => !isSearchUi(b))
      .find((b) => /^ask(?: about this video)?$/i.test((b.getAttribute('aria-label') || b.textContent || '').trim()));
    if (!btn) {
      const signedOut = !!document.querySelector('a[href*="ServiceLogin"], ytd-masthead a[aria-label*="Sign in" i]');
      status(signedOut ? "YouTube's Ask button only appears when you are signed in to YouTube." : "YouTube's Ask feature is not offered on this video for your account.", 'bad');
      return;
    }
    const before = new Set(expandedPanels());
    btn.click();
    const panel = await waitFor(() => expandedPanels().find((p) => !before.has(p)) || askPanel(), 5000);
    askPanelEl = panel || null;
    const input = panel ? await waitFor(() => textBoxIn(panel), 4000) : null;
    if (!input) {
      const copied = await copyQuestion();
      status(`${panel ? 'The Ask panel is open' : 'The Ask button was clicked'}, but I could not find its question box, so I did not type anything. ${copied ? 'The question is copied: paste it into' : 'Type this into'} YouTube's Ask box${copied ? '' : `: "${QUESTION}"`}, send it, then press "Read Ask answer".`);
      return;
    }
    input.focus();
    if ('value' in input) {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
      setter ? setter.call(input, QUESTION) : (input.value = QUESTION);
    } else input.textContent = QUESTION;
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: QUESTION }));
    await sleep(300);
    // send only from inside the Ask panel
    const sendBtn = [...panel.querySelectorAll('button[aria-label*="send" i], button[aria-label*="submit" i]')].find((b) => !isSearchUi(b));
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
    status(r.data.length ? `Found ${r.data.length > 1 ? `${r.data.length} builds` : 'a build'} in YouTube's AI answer (AI can be wrong, check the video):` : "YouTube's AI answer did not name four perks.", r.data.length ? '' : 'bad');
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
