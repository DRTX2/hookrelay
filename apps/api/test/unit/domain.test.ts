import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetch } from 'undici';
import { describe, expect, it } from 'vitest';
import { generateSecret, sign, signedHeaders, verify } from '../../src/delivery/domain/signing.js';
import { decide, parseSchedule, retryDelayMs } from '../../src/delivery/domain/retry-policy.js';
import { assertSafeUrl, createSafeAgent, isPrivateAddress } from '../../src/delivery/infrastructure/ssrf.js';

describe('signing (Standard Webhooks)', () => {
  // Official test vector from the Standard Webhooks spec repository
  it('matches the spec test vector', () => {
    const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
    const body = '{"test": 2432232314}';
    expect(sign(secret, 'msg_p5jXN8AQM9LWM0D4loKWxJek', 1614265330, body))
      .toBe('v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=');
  });

  it('round-trips and rejects tampering, wrong secret and stale timestamps', () => {
    const secret = generateSecret();
    const now = Date.now();
    const h = signedHeaders(secret, 'msg_1', '{"a":1}', now);
    expect(verify(secret, h, '{"a":1}', 300, now)).toBe(true);
    expect(verify(secret, h, '{"a":2}', 300, now)).toBe(false);
    expect(verify(generateSecret(), h, '{"a":1}', 300, now)).toBe(false);
    expect(verify(secret, h, '{"a":1}', 300, now + 301_000)).toBe(false);
  });

  it('accepts any of several signatures (secret rotation)', () => {
    const secret = generateSecret();
    const h = signedHeaders(secret, 'msg_1', 'x');
    expect(verify(secret, { ...h, 'webhook-signature': `v1,bogus ${h['webhook-signature']}` }, 'x')).toBe(true);
  });
});

describe('backoff', () => {
  it('follows the schedule with ±20% jitter', () => {
    const s = [5, 300];
    expect(retryDelayMs(1, s, () => 0.5)).toBe(5000);
    expect(retryDelayMs(1, s, () => 0)).toBe(4000);
    expect(retryDelayMs(2, s, () => 1)).toBe(360_000);
    expect(retryDelayMs(9, s, () => 0.5)).toBe(300_000); // clamps to last step
  });

  it('rejects garbage schedules', () => {
    expect(() => parseSchedule('5,abc')).toThrow();
    expect(parseSchedule('1, 2')).toEqual([1, 2]);
  });
});

describe('retry decision', () => {
  const s = [1, 2];
  it.each([
    [200, 1, false, 'success'],
    [204, 3, false, 'success'],
    [410, 1, false, 'gone'],
    [500, 1, false, 'retry'],
    [null, 2, false, 'retry'],
    [500, 3, false, 'exhausted'], // schedule of 2 retries => 3 attempts total
    [500, 1, true, 'exhausted'],  // manual resend never auto-retries
  ] as const)('status %s attempt %s manual %s -> %s', (code, attempt, manual, kind) => {
    expect(decide(code, attempt, manual, [...s]).kind).toBe(kind);
  });
});

describe('SSRF guard', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:127.0.0.1', '0.0.0.0'])(
    'blocks %s', (ip) => expect(isPrivateAddress(ip)).toBe(true),
  );
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('allows %s', (ip) => expect(isPrivateAddress(ip)).toBe(false));

  it('validates URLs', () => {
    expect(() => assertSafeUrl('ftp://example.com', false)).toThrow();
    expect(() => assertSafeUrl('http://user:pw@example.com', false)).toThrow();
    expect(() => assertSafeUrl('http://169.254.169.254/latest', false)).toThrow();
    expect(() => assertSafeUrl('http://[::1]:8080', false)).toThrow();
    expect(assertSafeUrl('https://example.com/hook', false).hostname).toBe('example.com');
    expect(assertSafeUrl('http://127.0.0.1:4000', true).port).toBe('4000');
  });
});

describe('SSRF-safe agent (checked at connect time, after DNS resolution)', () => {
  it('refuses a hostname that resolves to a private address, allows it when explicitly enabled', async () => {
    const server = createServer((_req, res) => res.end('internal')).listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const url = `http://localhost:${(server.address() as AddressInfo).port}/`; // name, not IP: exercises the DNS hook
    try {
      const blocked = await fetch(url, { dispatcher: createSafeAgent(false) }).catch((e: Error & { cause?: Error }) => e.cause ?? e);
      expect(String((blocked as Error).message)).toMatch(/Refusing to connect to private address/);
      const allowed = await fetch(url, { dispatcher: createSafeAgent(true) });
      expect(await allowed.text()).toBe('internal');
    } finally {
      server.close();
    }
  });
});
