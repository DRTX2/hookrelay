'use server';

import { refresh } from 'next/cache';
import { api, ApiError } from '@/lib/api';

export type FormState = { error?: string; ok?: string } | null;

async function run(fn: () => Promise<string | void>): Promise<FormState> {
  try {
    const ok = await fn();
    refresh();
    return { ok: ok ?? 'Done' };
  } catch (e) {
    return { error: e instanceof ApiError ? e.message : 'Unexpected error' };
  }
}

export async function createEndpoint(_: FormState, form: FormData): Promise<FormState> {
  const eventTypes = String(form.get('eventTypes') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return run(async () => {
    await api('/v1/endpoints', {
      method: 'POST',
      body: JSON.stringify({ url: form.get('url'), description: form.get('description') || undefined, eventTypes }),
    });
    return 'Endpoint created';
  });
}

export async function sendTestEvent(_: FormState, form: FormData): Promise<FormState> {
  let payload: unknown;
  try {
    payload = JSON.parse(String(form.get('payload') || '{}'));
  } catch {
    return { error: 'Payload must be valid JSON' };
  }
  const idem = String(form.get('idempotencyKey') ?? '').trim();
  return run(async () => {
    const r = await api<{ fanout: number; duplicate: boolean }>('/v1/messages', {
      method: 'POST',
      body: JSON.stringify({ eventType: form.get('eventType'), payload }),
      headers: idem ? { 'idempotency-key': idem } : {},
    });
    return r.duplicate ? 'Duplicate key: existing message returned, nothing re-sent' : `Fanned out to ${r.fanout} endpoint(s)`;
  });
}

export async function setEndpointEnabled(id: string, enabled: boolean) {
  await api(`/v1/endpoints/${id}/${enabled ? 'enable' : 'disable'}`, { method: 'POST' });
  refresh();
}

export async function deleteEndpoint(id: string) {
  await api(`/v1/endpoints/${id}`, { method: 'DELETE' });
  refresh();
}

export async function retryDelivery(id: string) {
  await api(`/v1/deliveries/${id}/retry`, { method: 'POST' });
  refresh();
}
