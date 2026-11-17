#!/usr/bin/env node
// Local server: serves the site and answers API queries.
//
//   GET /api/v1/builds?q=legion&tag=toxic&tag=hex&role=killer&killer=Legion&category=meta&video=1&dr=1&limit=50
//   GET /api/v1/perks?q=haste&role=survivor
//   GET /api/v1/<anything>.json      (the static API files, as deployed)
//
// The hosted site needs none of this (it filters the static JSON in the
// browser with the same query module); this exists for local use and for
// other tools that want to query the archive.
//
// Usage: node server.mjs [port]

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { indexBuilds, filterBuilds } from './site/js/engine/query.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.join(ROOT, 'site');
const PORT = Number(process.argv[2] || process.env.PORT || 4173);

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8',
};

let cache = null;
async function data() {
  const stamp = (await fs.stat(path.join(SITE, 'api/v1/builds.json'))).mtimeMs;
  if (cache && cache.stamp === stamp) return cache;
  const read = async (f) => JSON.parse(await fs.readFile(path.join(SITE, 'api/v1', f), 'utf8'));
  const perks = (await read('perks.json')).perks;
  const builds = (await read('builds.json')).builds;
  const perkById = new Map(perks.map((p) => [p.id, p]));
  indexBuilds(builds, perkById);
  cache = { stamp, perks, builds, perkById };
  return cache;
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'GET only' });

    if (url.pathname === '/api/v1/builds') {
      const d = await data();
      const q = url.searchParams;
      const limit = Math.min(500, Math.max(1, Number(q.get('limit')) || 100));
      const hits = filterBuilds(d.builds, {
        q: q.get('q') || '', role: q.get('role') || '', killer: q.get('killer') || '', category: q.get('category') || '',
        source: q.get('source') || '', tags: q.getAll('tag'), video: q.get('video') === '1', dr: q.get('dr') === '1',
      });
      const strip = ({ _hay, _hayNorm, ...b }) => b;
      return json(res, 200, { total: hits.length, builds: hits.slice(0, limit).map(strip) });
    }
    if (url.pathname === '/api/v1/perks') {
      const d = await data();
      const term = (url.searchParams.get('q') || '').toLowerCase();
      const role = url.searchParams.get('role') || '';
      const hits = d.perks.filter((p) => (!role || p.role === role) && (!term || `${p.name} ${(p.altNames || []).join(' ')} ${p.text}`.toLowerCase().includes(term)));
      return json(res, 200, { total: hits.length, perks: hits });
    }

    // static files, confined to site/
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(SITE, rel));
    if (!file.startsWith(SITE + path.sep)) return json(res, 403, { error: 'forbidden' });
    const body = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Access-Control-Allow-Origin': '*' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') return json(res, 404, { error: 'not found' });
    json(res, 500, { error: 'server error' });
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`DBD build archive: http://localhost:${PORT}/`));
