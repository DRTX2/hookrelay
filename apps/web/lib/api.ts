import 'server-only';
import { connection } from 'next/server';

// BFF: the API key lives only on the Next.js server, the browser never sees it.
const BASE = process.env.HOOKRELAY_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  await connection(); // always render at request time: data is live and the key is a runtime secret
  const key = process.env.HOOKRELAY_API_KEY;
  if (!key) throw new ApiError(500, 'HOOKRELAY_API_KEY is not set');
  const res = await fetch(BASE + path, {
    ...init,
    cache: 'no-store',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...init.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = Array.isArray(body.message) ? body.message.join(', ') : body.message ?? res.statusText;
    throw new ApiError(res.status, msg);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const apiBase = () => BASE;

export type Status = 'pending' | 'succeeded' | 'failed';

export interface Stats {
  succeeded: number; failed: number; pending: number; successRate: number | null;
  p50: number | null; p95: number | null; attempts: number;
  series: { hour: string; ok: number; err: number }[];
}
export interface Endpoint {
  id: string; url: string; description: string | null; eventTypes: string[] | null; failureStreak: number;
  disabledAt: string | null; disabledReason: string | null; createdAt: string;
  succeeded24h: number; failed24h: number; pending: number; secret?: string;
}
export interface MessageRow {
  id: string; eventType: string; createdAt: string; fanout: number; succeeded: number; failed: number; pending: number;
}
export interface Attempt {
  attemptNo: number; statusCode: number | null; durationMs: number; responseBody: string | null; error: string | null; createdAt: string;
}
export interface MessageDetail {
  id: string; eventType: string; payload: unknown; idempotencyKey: string | null; createdAt: string;
  deliveries: { id: string; status: Status; attemptCount: number; nextAttemptAt: string | null; lastError: string | null; endpointId: string; endpointUrl: string; attempts: Attempt[] }[];
}
export interface DeadLetter {
  id: string; attemptCount: number; lastError: string | null; failedAt: string;
  messageId: string; eventType: string; endpointId: string; endpointUrl: string;
}
