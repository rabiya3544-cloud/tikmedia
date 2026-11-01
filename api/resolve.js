// api/resolve.js
export const config = {
  runtime: 'edge', // Essential for streaming and better timeout
};

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const videoUrl = searchParams.get('url');

  if (!videoUrl) {
    return new Response(JSON.stringify({ error: 'Missing "url" parameter' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Decode the URL (it will be URL-encoded when passed as a parameter)
    const targetUrl = decodeURIComponent(videoUrl);

    // These headers are critical to bypass TikTok's CDN protection[reference:2][reference:3]
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://www.tiktok.com/',
      'Accept': '*/*',
      'Accept-Encoding': 'identity', // Prevents compression, essential for streaming[reference:4]
    };

    // If you have a tt_chain_token cookie, you can add it here:
    // headers['Cookie'] = 'tt_chain_token=YOUR_TOKEN_HERE';

    const upstreamResponse = await fetch(targetUrl, {
      method: 'GET',
      headers: headers,
      redirect: 'follow', // Follow any redirects TikTok might send
    });

    if (!upstreamResponse.ok) {
      // Forward the error status and body if the upstream fetch fails
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
      });
    }

    // Create a new response that streams the video body directly from upstream
    // We also add CORS headers so your frontend can call this proxy if needed[reference:5]
    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', upstreamResponse.headers.get('Content-Type') || 'video/mp4');
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');

    // Handle CORS preflight requests
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: responseHeaders });
    }

    // Stream the video data directly to the client (Rendi)
    return new Response(upstreamResponse.body, {
      status: 200,
      headers: responseHeaders,
    });

  } catch (error) {
    console.error('Proxy error:', error);
    return new Response(JSON.stringify({ error: 'Failed to proxy video stream.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
