// Reference receiver: verifies Standard Webhooks signatures with nothing but node:crypto,
// dedupes on webhook-id, and fails FAIL_RATE of requests on purpose so you can watch retries.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const SECRET = process.env.WEBHOOK_SECRET ?? '';
const FAIL_RATE = Number(process.env.FAIL_RATE ?? 0.3);
const seen = new Set(); // shortcut: in-memory dedupe, use a DB unique key in real receivers

function verify(headers, body) {
  const id = headers['webhook-id'], ts = Number(headers['webhook-timestamp']), sigs = headers['webhook-signature'];
  if (!id || !sigs || Math.abs(Date.now() / 1000 - ts) > 300) return false;
  const key = Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64');
  const expected = Buffer.from('v1,' + createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64'));
  return sigs.split(' ').some((s) => s.length === expected.length && timingSafeEqual(Buffer.from(s), expected));
}

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (SECRET && !verify(req.headers, body)) return res.writeHead(401).end('bad signature');
    if (Math.random() < FAIL_RATE) return res.writeHead(503).end('simulated outage');
    const id = req.headers['webhook-id'];
    const dup = seen.has(id);
    seen.add(id);
    console.log(`${dup ? 'dup ' : ''}${id} ${JSON.parse(body).type}`);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ received: true, duplicate: dup }));
  });
}).listen(Number(process.env.PORT ?? 4000), () => console.log('receiver listening'));
