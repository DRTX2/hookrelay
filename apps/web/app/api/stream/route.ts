import { apiBase } from '@/lib/api';

// Proxies the API's SSE stream so the browser can subscribe without holding the API key.
export async function GET(req: Request) {
  const upstream = await fetch(`${apiBase()}/v1/stream`, {
    headers: { authorization: `Bearer ${process.env.HOOKRELAY_API_KEY}` },
    signal: req.signal,
    cache: 'no-store',
  });
  if (!upstream.ok || !upstream.body) return new Response('stream unavailable', { status: 502 });
  return new Response(upstream.body, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive' },
  });
}
