#!/usr/bin/env node
// The extension uses the same detection code as the site and the sync.
// This copies it into extension/lib (extensions cannot import from outside their folder).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['detect.mjs', 'text.mjs']) {
  await fs.copyFile(path.join(ROOT, 'site/js/engine', f), path.join(ROOT, 'extension/lib', f));
}
console.log('extension/lib updated');
