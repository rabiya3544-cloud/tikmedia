// api/fetch.js —  POST { url }  →  video/mp4 bytes
const ALLOWED_HOSTS = /(^|\.)(tiktokv|tiktokcdn|byteoversea|ibytedtos|muscdn|tos-)\.com$/i;

const config = { maxDuration: 60, memory: 1024 };

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: 'invalid JSON body' });
  }

  const url = body && body.url;
  if (!url) return res.status(400).json({ error: 'url required' });

  let parsed;
  try { parsed = new URL(url); }
  catch { return res.status(400).json({ error: 'invalid url' }); }

  if (!ALLOWED_HOSTS.test(parsed.hostname)) {
    return res.status(400).json({ error: 'host not allowed' });
  }

  const upstream = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://www.tiktok.com/'
    }
  }).catch(e => { throw new Error('fetch failed: ' + e.message); });

  if (!upstream.ok) {
    return res.status(502).json({ error: 'upstream HTTP ' + upstream.status });
  }

  const total = Number(upstream.headers.get('content-length')) || 0;
  res.setHeader('Content-Type', 'video/mp4');
  if (total) res.setHeader('Content-Length', String(total));

  // Stream the body directly to the client
  for await (const chunk of upstream.body) {
    res.write(chunk);
  }
  res.end();
}

module.exports = handler;
module.exports.config = config;
