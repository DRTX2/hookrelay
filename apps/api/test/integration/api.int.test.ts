/**
 * Black-box integration suite: the real built API + worker processes against real Postgres and
 * Redis, with an in-process webhook receiver. Run with `pnpm test:int` (CI: services in ci.yml).
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { Redis } from 'ioredis';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verify } from '../../src/delivery/domain/signing.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://hookrelay:hookrelay@localhost:5432/hookrelay_test';
const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15';
const PORT = 3999;
const API = `http://127.0.0.1:${PORT}`;
const METRICS = 'http://127.0.0.1:9499/metrics';
const ADMIN = 'integration-admin';

// Safety: this suite wipes data, so refuse to run against anything that is not clearly a test store.
if (!new URL(DATABASE_URL).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must point to a *_test database');
if (!REDIS_URL.endsWith('/15')) throw new Error('TEST_REDIS_URL must use Redis db 15');

const procs: ChildProcess[] = [];
let receiver: Server;
let receiverUrl = '';
const received: { path: string; headers: Record<string, string>; body: string }[] = [];
const responses = new Map<string, number[]>(); // path -> queue of status codes to return (default 200)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function eventually<T>(fn: () => Promise<T>, ok: (v: T) => boolean, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (ok(v)) return v;
    if (Date.now() > deadline) throw new Error(`condition not met in ${timeoutMs}ms: ${JSON.stringify(v)}`);
    await sleep(200);
  }
}

let apiKey = '';
const pgOne = async (sql: string) => {
  const c = new pg.Client({ connectionString: DATABASE_URL });
  await c.connect();
  try { return (await c.query(sql)).rows[0]; } finally { await c.end(); }
};
const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
};

beforeAll(async () => {
  // 1. Fresh database and queue
  const admin = new pg.Client({ connectionString: DATABASE_URL.replace(/\/[^/]+$/, '/postgres') });
  await admin.connect();
  const dbName = new URL(DATABASE_URL).pathname.slice(1);
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const redis = new Redis(REDIS_URL);
  await redis.flushdb();
  redis.disconnect();

  // 2. Programmable receiver
  receiver = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ path: req.url!, headers: req.headers as Record<string, string>, body });
      const status = responses.get(req.url!)?.shift() ?? 200;
      res.writeHead(status).end(status < 300 ? 'ok' : 'nope');
    });
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}`;

  // 3. Real processes from dist/
  const env = {
    ...process.env, DATABASE_URL, REDIS_URL, ADMIN_TOKEN: ADMIN, PORT: String(PORT), METRICS_PORT: '9499',
    ALLOW_PRIVATE_TARGETS: 'true', NIMBUS_WEBHOOK_SECRET: 'atalaya-shared-secret-for-tests', RETRY_SCHEDULE: '1,1', ENDPOINT_DISABLE_AFTER: '3', RATE_LIMIT_PER_MINUTE: '40', LOG_FORMAT: 'json',
  };
  const dist = join(import.meta.dirname, '../../dist');
  for (const entry of ['main.js', 'worker.js']) {
    const p = spawn(process.execPath, [join(dist, entry)], { env, stdio: ['ignore', 'ignore', 'inherit'] });
    procs.push(p);
  }
  await eventually(() => fetch(`${API}/health`).then((r) => r.status).catch(() => 0), (s) => s === 200);
  await eventually(() => fetch(METRICS).then((r) => r.status).catch(() => 0), (s) => s === 200);
});

afterAll(async () => {
  procs.forEach((p) => p.kill('SIGTERM'));
  receiver?.close();
});

describe('Hookrelay API (black box)', () => {
  it('creates a tenant with an admin token and rejects bad credentials', async () => {
    const denied = await fetch(`${API}/v1/apps`, { method: 'POST', headers: { 'x-admin-token': 'nope', 'content-type': 'application/json' }, body: '{"name":"x"}' });
    expect(denied.status).toBe(401);
    const res = await fetch(`${API}/v1/apps`, { method: 'POST', headers: { 'x-admin-token': ADMIN, 'content-type': 'application/json' }, body: '{"name":"acme"}' });
    expect(res.status).toBe(201);
    apiKey = (await res.json()).apiKey;
    expect(apiKey).toMatch(/^hr_/);
    expect((await fetch(`${API}/v1/endpoints`)).status).toBe(401);
  });

  it('validates input with the published zod contracts', async () => {
    expect((await call('POST', '/v1/endpoints', { url: 'ftp://x.test' })).status).toBe(400);
    expect((await call('POST', '/v1/messages', { eventType: 'bad type!', payload: 1 })).status).toBe(400);
    const spec = await (await fetch(`${API}/openapi.json`)).json();
    expect(spec.paths['/v1/messages'].post.requestBody.content['application/json'].schema.properties.eventType).toBeDefined();
  });

  it('delivers a signed webhook exactly as the Standard Webhooks spec describes', async () => {
    const ep = await call('POST', '/v1/endpoints', { url: `${receiverUrl}/ok`, eventTypes: ['order.created'] });
    expect(ep.status).toBe(201);
    const msg = await call('POST', '/v1/messages', { eventType: 'order.created', payload: { orderId: 1 } });
    expect(msg.status).toBe(202);
    expect(msg.body.fanout).toBe(1);
    const hit = await eventually(async () => received.find((r) => r.path === '/ok'), Boolean);
    expect(verify(ep.body.secret, hit!.headers, hit!.body)).toBe(true);
    expect(JSON.parse(hit!.body)).toMatchObject({ type: 'order.created', data: { orderId: 1 } });
  });

  it('is idempotent per Idempotency-Key', async () => {
    const a = await call('POST', '/v1/messages', { eventType: 'order.created', payload: { n: 2 } }, { 'idempotency-key': 'k-1' });
    const b = await call('POST', '/v1/messages', { eventType: 'order.created', payload: { n: 2 } }, { 'idempotency-key': 'k-1' });
    expect([a.status, b.status]).toEqual([202, 200]);
    expect(b.body).toMatchObject({ id: a.body.id, duplicate: true });
  });

  it('retries a failing receiver with backoff until it succeeds', async () => {
    responses.set('/flaky', [503, 503]);
    await call('POST', '/v1/endpoints', { url: `${receiverUrl}/flaky`, eventTypes: ['invoice.paid'] });
    const msg = await call('POST', '/v1/messages', { eventType: 'invoice.paid', payload: { id: 9 } });
    const detail = await eventually(() => call('GET', `/v1/messages/${msg.body.id}`), (r) => r.body.deliveries[0]?.status === 'succeeded');
    expect(detail.body.deliveries[0].attempts.map((a: { statusCode: number }) => a.statusCode)).toEqual([503, 503, 200]);
  });

  it('opens the circuit after consecutive failures and allows a manual resend', async () => {
    responses.set('/down', Array(20).fill(500));
    const ep = await call('POST', '/v1/endpoints', { url: `${receiverUrl}/down`, eventTypes: ['user.deleted'] });
    const msg = await call('POST', '/v1/messages', { eventType: 'user.deleted', payload: { id: 1 } });
    const failed = await eventually(() => call('GET', `/v1/messages/${msg.body.id}`), (r) => r.body.deliveries[0]?.status === 'failed');
    const endpoint = await call('GET', `/v1/endpoints/${ep.body.id}`);
    expect(endpoint.body.disabledReason).toBe('Too many consecutive failures');

    await call('POST', `/v1/endpoints/${ep.body.id}/enable`);
    responses.set('/down', []); // receiver recovered
    const resend = await call('POST', `/v1/deliveries/${failed.body.deliveries[0].id}/retry`);
    expect(resend.status).toBe(202);
    await eventually(() => call('GET', `/v1/messages/${msg.body.id}`), (r) => r.body.deliveries[0]?.status === 'succeeded');
  });

  it('collects exhausted deliveries in the DLQ and replays them exactly once, even with concurrent replays', async () => {
    responses.set('/outage', Array(50).fill(503));
    const ep = await call('POST', '/v1/endpoints', { url: `${receiverUrl}/outage`, eventTypes: ['order.refunded'] });
    for (let i = 0; i < 3; i++) await call('POST', '/v1/messages', { eventType: 'order.refunded', payload: { i } });
    const dlq = await eventually(() => call('GET', `/v1/dead-letters?endpointId=${ep.body.id}`), (r) => r.body.total === 3);
    expect(dlq.body.data[0]).toMatchObject({ endpointUrl: `${receiverUrl}/outage`, eventType: 'order.refunded' });

    // Customer fixes their endpoint; two operators hit "replay" at the same time.
    responses.set('/outage', []);
    await call('POST', `/v1/endpoints/${ep.body.id}/enable`);
    const before = received.filter((r) => r.path === '/outage' && r.body).length;
    const [a, b] = await Promise.all([
      call('POST', '/v1/dead-letters/replay', { endpointId: ep.body.id }),
      call('POST', '/v1/dead-letters/replay', { endpointId: ep.body.id }),
    ]);
    expect(a.body.replayed + b.body.replayed).toBe(3);
    await eventually(() => call('GET', `/v1/dead-letters?endpointId=${ep.body.id}`), (r) => r.body.total === 0);
    await sleep(1500);
    const successes = received.filter((r) => r.path === '/outage').length - before;
    expect(successes).toBe(3); // no duplicate sends
  });

  it('accepts HMAC-signed Nimbus incidents and delivers them as webhooks, once (Atalaya integration)', async () => {
    const me = await pgOne(`SELECT id FROM apps WHERE name='acme'`);
    await call('POST', '/v1/endpoints', { url: `${receiverUrl}/oncall`, eventTypes: ['incident.opened'] });
    const post = async (body: object, secret = 'atalaya-shared-secret-for-tests') => {
      const raw = JSON.stringify(body);
      const t = Math.floor(Date.now() / 1000);
      const sig = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
      const res = await fetch(`${API}/v1/inbound/nimbus/${me.id}`, { method: 'POST', headers: { 'content-type': 'application/json', 'nimbus-signature': `t=${t},v1=${sig}` }, body: raw });
      return { status: res.status, body: await res.json() };
    };
    const incident = { incidentId: 'inc-9', event: 'opened', pipelineName: 'Orders', summary: 'Consumer stalled' };
    expect((await post(incident, 'not-the-secret-xxxxxxxx')).status).toBe(401);
    const first = await post(incident);
    expect(first).toMatchObject({ status: 202, body: { fanout: 1, duplicate: false } });
    expect((await post(incident)).body).toMatchObject({ id: first.body.id, duplicate: true });
    const hit = await eventually(async () => received.find((r) => r.path === '/oncall'), Boolean);
    expect(JSON.parse(hit!.body)).toMatchObject({ type: 'incident.opened', data: { incidentId: 'inc-9', pipelineName: 'Orders' } });
  });

  it('exposes Prometheus metrics from the worker', async () => {
    const text = await (await fetch(METRICS)).text();
    expect(text).toMatch(/hookrelay_delivery_attempts_total\{outcome="success"\} \d+/);
    expect(text).toMatch(/hookrelay_queue_jobs\{state="waiting"\}/);
  });

  it('rate limits ingestion per tenant', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 45; i++) statuses.push((await call('POST', '/v1/messages', { eventType: 'noise', payload: { i } })).status);
    expect(statuses).toContain(429);
    const limited = await call('POST', '/v1/messages', { eventType: 'noise', payload: {} });
    expect(limited.headers.get('retry-after')).toBeTruthy();
  });
});
