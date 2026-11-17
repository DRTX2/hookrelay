import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Standard Webhooks spec (https://www.standardwebhooks.com): HMAC-SHA256 over "id.timestamp.body",
// secret is "whsec_" + base64 bytes, header carries space-separated "v1,<sig>" entries (allows key rotation).
const PREFIX = 'whsec_';

export function generateSecret(): string {
  return PREFIX + randomBytes(24).toString('base64');
}

function key(secret: string): Buffer {
  return Buffer.from(secret.startsWith(PREFIX) ? secret.slice(PREFIX.length) : secret, 'base64');
}

export function sign(secret: string, msgId: string, timestamp: number, body: string): string {
  const mac = createHmac('sha256', key(secret)).update(`${msgId}.${timestamp}.${body}`).digest('base64');
  return `v1,${mac}`;
}

export function signedHeaders(secret: string, msgId: string, body: string, now = Date.now()) {
  const timestamp = Math.floor(now / 1000);
  return {
    'webhook-id': msgId,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': sign(secret, msgId, timestamp, body),
  };
}

/** Receiver-side check, exported so examples/receiver and the README use the exact same logic. */
export function verify(
  secret: string,
  headers: Record<string, string | undefined>,
  body: string,
  toleranceSec = 300,
  now = Date.now(),
): boolean {
  const id = headers['webhook-id'];
  const ts = Number(headers['webhook-timestamp']);
  const sigs = headers['webhook-signature'];
  if (!id || !sigs || !Number.isFinite(ts)) return false;
  if (Math.abs(now / 1000 - ts) > toleranceSec) return false; // replay protection
  const expected = Buffer.from(sign(secret, id, ts, body));
  return sigs.split(' ').some((candidate) => {
    const got = Buffer.from(candidate);
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}
