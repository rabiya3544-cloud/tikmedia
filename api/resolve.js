export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const videoUrl = searchParams.get('url');

  // CORS preflight — must answer before any real request
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range',              // ← unlocks browser Range test
        'Access-Control-Max-Age': '86400',
        'Access-Control-Expose-Headers':
          'Content-Length, Content-Range, Accept-Ranges, Content-Disposition',
      },
    });
  }

  if (!videoUrl) {
    return new Response(JSON.stringify({ error: 'Missing "url"' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const targetUrl = decodeURIComponent(videoUrl);

  // Forward inbound Range header to TikTok so partial downloads work
  const upstreamHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Referer': 'https://www.tiktok.com/',
    'Accept': '*/*',
    'Accept-Encoding': 'identity',
  };
  const inboundRange = req.headers.get('range');
  if (inboundRange) upstreamHeaders['Range'] = inboundRange;

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,              // pass GET or HEAD through
      headers: upstreamHeaders,
      redirect: 'follow',
    });

    const out = new Headers();

    // Forward every header Rendi (or the browser) cares about
    const forward = [
      'content-type',
      'content-length',
      'accept-ranges',
      'content-range',
      'content-disposition',
      'last-modified',
      'etag',
    ];
    for (const h of forward) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }

    // CORS
    out.set('Access-Control-Allow-Origin', '*');
    out.set('Access-Control-Expose-Headers',
      'Content-Length, Content-Range, Accept-Ranges, Content-Disposition');

    return new Response(req.method === 'HEAD' ? null : upstream.body, {
      status: upstream.status,          // preserves 206 for Range
      statusText: upstream.statusText,
      headers: out,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }
}
