#!/usr/bin/env node
// Resolve YouTube channels to the ids the sync needs.
//   node api/tools/resolve-channel.mjs @handle https://www.youtube.com/@other UCxxxxxxxxxxxxxxxxxxxxxx
// Prints one JSON line per channel: {"id":"UC...","name":"..."} ready for data/curated/channels.json
import { fetchText } from '../lib/http.mjs';
import { parseFeed } from '../sources/youtube.mjs';

for (const arg of process.argv.slice(2)) {
  try {
    let id = /^UC[A-Za-z0-9_-]{22}$/.test(arg) ? arg : null;
    if (!id) {
      const url = /^https?:\/\//.test(arg) ? arg : `https://www.youtube.com/${arg.startsWith('@') ? arg : `@${arg}`}`;
      if (!/^https:\/\/(www\.)?youtube\.com\//.test(url)) throw new Error('not a YouTube URL');
      const html = await fetchText(url, { headers: { 'Accept-Language': 'en' } });
      id = (/"externalId":"(UC[A-Za-z0-9_-]{22})"/.exec(html) || /channel_id=(UC[A-Za-z0-9_-]{22})/.exec(html) || [])[1];
      if (!id) throw new Error('channel id not found on the page');
    }
    const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
    const name = (/<title>([^<]*)<\/title>/.exec(xml) || [])[1] || '';
    const vids = parseFeed(xml);
    console.log(JSON.stringify({ id, name, latest: vids[0]?.title || null }));
  } catch (err) {
    console.log(JSON.stringify({ input: arg, error: err.message }));
  }
}
