// Source: YouTube, without an API key.
//  - oEmbed confirms a video exists and returns its title / channel.
//  - Public channel feeds list each channel's 15 most recent uploads.

import { fetchStatus, fetchText } from '../lib/http.mjs';

export const info = {
  id: 'youtube',
  name: 'YouTube creator channels',
  url: 'https://www.youtube.com/',
  provides: 'Build videos from vetted Dead by Daylight creators',
};

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

export async function verifyVideo(id) {
  if (!VIDEO_ID.test(id)) return null;
  const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`;
  try {
    const { status, body } = await fetchStatus(url, { retries: 1 });
    if (status !== 200 || !body?.title) return null;
    return { id, title: String(body.title), channel: String(body.author_name || ''), channelUrl: String(body.author_url || '') };
  } catch {
    return undefined; // network trouble: unknown, keep whatever we had
  }
}

const decode = (s) =>
  String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');

export function parseFeed(xml) {
  const out = [];
  const channel = decode((/<title>([^<]*)<\/title>/.exec(xml) || [])[1] || '');
  for (const entry of xml.split('<entry>').slice(1)) {
    const id = (/<yt:videoId>([^<]+)</.exec(entry) || [])[1];
    if (!id || !VIDEO_ID.test(id)) continue;
    out.push({
      id,
      title: decode((/<title>([^<]*)<\/title>/.exec(entry) || [])[1] || ''),
      channel,
      published: (/<published>([^<]+)</.exec(entry) || [])[1] || null,
      description: decode((/<media:description>([\s\S]*?)<\/media:description>/.exec(entry) || [])[1] || ''),
    });
  }
  return out;
}

export async function channelFeed(channelId) {
  if (!/^UC[A-Za-z0-9_-]{22}$/.test(channelId)) return [];
  const xml = await fetchText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { retries: 1 });
  return parseFeed(xml);
}
