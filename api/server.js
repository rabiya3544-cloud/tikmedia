// api/server.js  —  POST { url, date?, likes? }  →  { ok, filename, url, bytes }
const { put } = require('@vercel/blob');

// Hosts allowed to be fetched. Add more if you use other CDNs.
const ALLOWED_HOSTS = /(^|\.)(tiktokv|tiktokcdn|byteoversea|ibytedtos|muscdn|tos-)\.com$/i;

const MAX_BYTES = 300 * 1024 * 1024;   // 300 MB safety cap
const FETCH_TIMEOUT_MS = 90_000;

// Long-running fetch: Hobby allows up to 60s, Pro up to 300s.
// 60 is enough for a 106 MB file on a decent CDN.
const config = { maxDuration: 60, memory: 1024 };

async function handler(req, res) {
  // --- CORS: allow only your own origin in production ---
  res.setHeader('Access-Control-Allow-Origin', '*');          // ← tighten this
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // --- Parse body ---
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'invalid JSON body' });
  }

  const { url, date, likes } = body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url required' });
  }

  // --- Validate URL ---
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ error: 'invalid url' });
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return res.status(400).json({ error: 'only http(s) URLs' });
  }

  if (!ALLOWED_HOSTS.test(parsed.hostname)) {
    return res.status(400).json({
      error: 'host not allowed',
      host: parsed.hostname
    });
  }

  // --- Build filename: jafernegery<date>.mp4 ---
  let dateStr;
  if (date) {
    dateStr = String(date);
    const iso = dateStr.match(/^(\d{4}-\d{2}-\d{2})T/);
    if (iso) dateStr = iso[1];                                // trim time part
    dateStr = dateStr
      .replace(/[\\/:*?"<>|\s]/g, '_')                        // filesystem-safe
      .slice(0, 40);
  } else {
    dateStr = Date.now().toString();                          // fallback
  }
  const filename = `jafernegery${dateStr}.mp4`;

  // --- Fetch upstream ---
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);

  let upstream;
  try {
    upstream = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        // Some CDNs check these — browser-like values maximise success
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Referer': 'https://www.tiktok.com/',
        'Accept': '*/*'
      }
    });
  } catch (e) {
    clearTimeout(timer);
    const aborted = e.name === 'AbortError';
    return res.status(aborted ? 504 : 502).json({
      error: aborted ? 'upstream timeout' : 'upstream fetch failed',
      detail: e.message
    });
  }

  if (!upstream.ok) {
    clearTimeout(timer);
    return res.status(502).json({
      error: `upstream HTTP ${upstream.status}`,
      upstreamStatus: upstream.status
    });
  }

  const contentLength = Number(upstream.headers.get('content-length')) || 0;
  if (contentLength && contentLength > MAX_BYTES) {
    clearTimeout(timer);
    return res.status(413).json({
      error: 'file too large',
      bytes: contentLength,
      max: MAX_BYTES
    });
  }

  const contentType = upstream.headers.get('content-type') || '';
  if (contentType && !/^(video\/|application\/octet-stream|binary\/)/i.test(contentType)) {
    clearTimeout(timer);
    return res.status(415).json({
      error: 'unexpected content-type',
      contentType
    });
  }

  // --- Read fully into memory ---
  let buffer;
  try {
    buffer = Buffer.from(await upstream.arrayBuffer());
  } catch (e) {
    clearTimeout(timer);
    return res.status(502).json({ error: 'read failed', detail: e.message });
  }
  clearTimeout(timer);

  if (buffer.length > MAX_BYTES) {
    return res.status(413).json({
      error: 'file too large after download',
      bytes: buffer.length,
      max: MAX_BYTES
    });
  }

  // --- Store on Vercel Blob ---
  try {
    const blob = await put(filename, buffer, {
      access: 'public',
      contentType: 'video/mp4',
      addRandomSuffix: false,     // keep exact "jafernegery<date>.mp4"
      allowOverwrite: true        // same-day uploads overwrite; set false to 409 instead
    });

    return res.status(200).json({
      ok: true,
      filename,
      bytes: buffer.length,
      url: blob.url,
      likes: likes ?? null,
      datePosted: date ?? null
    });
  } catch (e) {
    return res.status(500).json({
      error: 'storage failed',
      detail: e.message
    });
  }
}

module.exports = handler;
module.exports.config = config;
