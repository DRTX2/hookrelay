import { describe, expect, it } from 'vitest';
import { DeliverAttempt } from '../../src/delivery/application/deliver-attempt.js';
import type {
  AttemptRecord, DeliveryContext, DeliveryEvent, DeliveryJob, DeliveryStore, SendResult,
} from '../../src/delivery/application/ports.js';
import { verify } from '../../src/delivery/domain/signing.js';

const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const NOW = new Date('2026-11-16T12:00:00Z');

function setup(opts: { ctx?: Partial<DeliveryContext> | null; send?: Partial<SendResult>; schedule?: number[] } = {}) {
  const ctx: DeliveryContext | null = opts.ctx === null ? null : {
    deliveryId: 'd1', status: 'pending', attemptCount: 0, messageId: 'm1', endpointId: 'e1', appId: 'a1',
    url: 'https://receiver.test/hook', secret: SECRET, endpointDisabled: false, eventType: 'order.created',
    payload: { id: 42 }, messageCreatedAt: NOW, ...opts.ctx,
  };
  const calls = { records: [] as AttemptRecord[], circuit: [] as string[], scheduled: [] as { jobs: DeliveryJob[]; delay?: number }[], events: [] as DeliveryEvent[], disabledFails: 0, sent: [] as { url: string; body: string; headers: Record<string, string> }[] };
  const store: DeliveryStore = {
    load: async () => ctx,
    failBecauseEndpointDisabled: async () => void calls.disabledFails++,
    recordAttempt: async (r) => { calls.records.push(r); calls.circuit.push(r.outcome); },
  };
  const useCase = new DeliverAttempt(
    store,
    { send: async (url, body, headers) => { calls.sent.push({ url, body, headers }); return { statusCode: 200, responseBody: 'ok', error: null, durationMs: 12, ...opts.send }; } },
    { schedule: async (jobs, delay) => void calls.scheduled.push({ jobs, delay }) },
    { publish: (e) => void calls.events.push(e) },
    opts.schedule ?? [1, 2],
    () => NOW,
  );
  return { useCase, calls };
}

describe('DeliverAttempt', () => {
  it('sends a Standard Webhooks signed request and records success', async () => {
    const { useCase, calls } = setup();
    const r = await useCase.execute({ deliveryId: 'd1', attempt: 1 });
    expect(r.kind).toBe('success');
    const sent = calls.sent[0];
    expect(JSON.parse(sent.body)).toEqual({ type: 'order.created', timestamp: NOW.toISOString(), data: { id: 42 } });
    expect(verify(SECRET, sent.headers, sent.body, 300, NOW.getTime())).toBe(true);
    expect(sent.headers['webhook-id']).toBe('m1'); // same id across retries -> receiver dedupe
    expect(calls.records[0]).toMatchObject({ attempt: 1, status: 'succeeded', nextAttemptAt: null, lastError: null });
    expect(calls.circuit).toEqual(['success']);
    expect(calls.scheduled).toEqual([]);
    expect(calls.events[0]).toMatchObject({ status: 'succeeded', attemptNo: 1, statusCode: 200 });
  });

  it('schedules the next attempt on a 5xx, persisting before scheduling', async () => {
    const { useCase, calls } = setup({ send: { statusCode: 503 } });
    const r = await useCase.execute({ deliveryId: 'd1', attempt: 1 });
    expect(r.kind).toBe('retry');
    expect(calls.records[0]).toMatchObject({ status: 'pending', lastError: 'HTTP 503' });
    expect(calls.records[0].nextAttemptAt!.getTime()).toBeGreaterThan(NOW.getTime());
    expect(calls.scheduled[0].jobs).toEqual([{ deliveryId: 'd1', attempt: 2 }]);
    expect(calls.scheduled[0].delay).toBeGreaterThanOrEqual(800); // 1s ±20%
    expect(calls.circuit).toEqual(['retry']);
  });

  it('treats network errors as retryable and keeps the error text', async () => {
    const { useCase, calls } = setup({ send: { statusCode: null, error: 'connect ECONNREFUSED' } });
    expect((await useCase.execute({ deliveryId: 'd1', attempt: 1 })).kind).toBe('retry');
    expect(calls.records[0].lastError).toBe('connect ECONNREFUSED');
  });

  it('fails the delivery once the schedule is exhausted', async () => {
    const { useCase, calls } = setup({ ctx: { attemptCount: 2 }, send: { statusCode: 500 } });
    expect((await useCase.execute({ deliveryId: 'd1', attempt: 3 })).kind).toBe('exhausted');
    expect(calls.records[0].status).toBe('failed');
    expect(calls.scheduled).toEqual([]);
  });

  it('stops on 410 Gone and reports it to the circuit breaker', async () => {
    const { useCase, calls } = setup({ send: { statusCode: 410 } });
    expect((await useCase.execute({ deliveryId: 'd1', attempt: 1 })).kind).toBe('gone');
    expect(calls.circuit).toEqual(['gone']);
    expect(calls.scheduled).toEqual([]);
  });

  it('never auto-retries a manual resend', async () => {
    const { useCase, calls } = setup({ ctx: { attemptCount: 3 }, send: { statusCode: 500 } });
    expect((await useCase.execute({ deliveryId: 'd1', attempt: 4, manual: true })).kind).toBe('exhausted');
    expect(calls.scheduled).toEqual([]);
  });

  it('fails without calling the receiver when the endpoint is disabled', async () => {
    const { useCase, calls } = setup({ ctx: { endpointDisabled: true } });
    expect((await useCase.execute({ deliveryId: 'd1', attempt: 1 })).kind).toBe('endpoint-disabled');
    expect(calls.sent).toEqual([]);
    expect(calls.disabledFails).toBe(1);
  });

  it.each([
    ['row deleted', null, 1],
    ['already delivered', { status: 'succeeded' as const }, 1],
    ['stale attempt number (duplicate job)', { attemptCount: 2 }, 2],
  ])('skips stale jobs: %s', async (_name, ctx, attempt) => {
    const { useCase, calls } = setup({ ctx });
    expect((await useCase.execute({ deliveryId: 'd1', attempt })).kind).toBe('skipped');
    expect(calls.sent).toEqual([]);
    expect(calls.records).toEqual([]);
  });
});
