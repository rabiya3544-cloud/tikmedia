// api/resolve.js
export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const videoUrl = searchParams.get('url');

  // ── CORS preflight ────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range',
        'Access-Control-Max-Age': '86400',
        'Access-Control-Expose-Headers':
          'Content-Length, Content-Range, Accept-Ranges, Content-Disposition',
      },
    });
  }

  if (!videoUrl) {
    return new Response(JSON.stringify({ error: 'Missing "url"' }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  const targetUrl = decodeURIComponent(videoUrl);

  // ── Upstream headers (identical for HEAD and GET) ─
  const upstreamHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Referer': 'https://www.tiktok.com/',
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
  };

  const inboundRange = req.headers.get('range');
  if (inboundRange) upstreamHeaders['Range'] = inboundRange;

  // ──────────────────────────────────────────────────
  // ★ HEAD EMULATION — must come here, after headers
  //   are built, before the main try/fetch.
  // ──────────────────────────────────────────────────
  if (req.method === 'HEAD') {
    // TikTok rejects HEAD; fetch 1 byte instead and return headers only
    try {
      const probe = await fetch(targetUrl, {
        method: 'GET',
        headers: { ...upstreamHeaders, 'Range': 'bytes=0-0' },
        redirect: 'follow',
      });
      try { await probe.body?.cancel(); } catch {}

      if (!probe.ok && probe.status !== 206) {
        return new Response(null, {
          status: probe.status,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Expose-Headers':
              'Content-Length, Content-Range, Accept-Ranges, Content-Disposition',
          },
        });
      }

      const out = new Headers();
      for (const h of [
        'content-type',
        'content-length',
        'accept-ranges',
        'content-range',
        'content-disposition',
        'last-modified',
        'etag',
      ]) {
        const v = probe.headers.get(h);
        if (v) out.set(h, v);
      }
      out.set('Access-Control-Allow-Origin', '*');
      out.set('Access-Control-Expose-Headers',
        'Content-Length, Content-Range, Accept-Ranges, Content-Disposition');

      return new Response(null, { status: 200, headers: out });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  }

  // ── Main GET path ─────────────────────────────────
  try {
    const upstream = await fetch(targetUrl, {
      method: 'GET',
      headers: upstreamHeaders,
      redirect: 'follow',
    });

    const out = new Headers();

    // Forward every header Rendi (or the browser) cares about
    for (const h of [
      'content-type',
      'content-length',
      'accept-ranges',
      'content-range',
      'content-disposition',
      'last-modified',
      'etag',
    ]) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }

    out.set('Access-Control-Allow-Origin', '*');
    out.set('Access-Control-Expose-Headers',
      'Content-Length, Content-Range, Accept-Ranges, Content-Disposition');

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: out,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
