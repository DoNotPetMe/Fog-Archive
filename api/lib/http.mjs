// Small fetch helpers for the sync pipeline. No dependencies (Node 20+).

const UA = 'dbd-build-archive/1.0 (static build browser; scheduled sync)';

async function request(url, { timeout = 30000, retries = 2, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*', ...headers }, signal: ctrl.signal, redirect: 'follow' });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${url}: ${lastErr?.message || lastErr}`);
}

export async function fetchJson(url, opts) {
  const res = await request(url, opts);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export async function fetchText(url, opts) {
  const res = await request(url, opts);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

export async function fetchBuffer(url, opts) {
  const res = await request(url, opts);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Returns the HTTP status without throwing on 4xx (used to verify a video exists). */
export async function fetchStatus(url, opts) {
  const res = await request(url, opts);
  let body = null;
  if (res.ok) {
    try { body = await res.json(); } catch { body = null; }
  }
  return { status: res.status, body };
}

/** Run async jobs with bounded concurrency so we stay polite to the sources. */
export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
