export const DEFAULT_SCHEDULE = [5, 300, 1800, 7200, 18000, 36000, 36000];

export function parseSchedule(raw: string | undefined): number[] {
  if (!raw) return DEFAULT_SCHEDULE;
  const parsed = raw.split(',').map((s) => Number(s.trim()));
  if (!parsed.length || parsed.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new Error(`Invalid RETRY_SCHEDULE: "${raw}"`);
  }
  return parsed;
}

/**
 * Delay in ms before retry number `attemptsMade` (1-based: 1 = first retry).
 * ±20% jitter spreads retries so a recovering endpoint is not hit by a thundering herd.
 */
export function retryDelayMs(attemptsMade: number, schedule: number[], random = Math.random): number {
  const base = schedule[Math.min(attemptsMade, schedule.length) - 1] * 1000;
  return Math.round(base * (0.8 + random() * 0.4));
}

export type Outcome =
  | { kind: 'success' }
  | { kind: 'gone' } // 410: the receiver told us to stop
  | { kind: 'retry'; delayMs: number }
  | { kind: 'exhausted' };

/** Pure decision table: what happens after an attempt. No I/O, unit tested. */
export function decide(statusCode: number | null, attemptNo: number, manual: boolean, schedule: number[]): Outcome {
  if (statusCode !== null && statusCode >= 200 && statusCode < 300) return { kind: 'success' };
  if (statusCode === 410) return { kind: 'gone' };
  if (manual || attemptNo >= schedule.length + 1) return { kind: 'exhausted' };
  return { kind: 'retry', delayMs: retryDelayMs(attemptNo, schedule) };
}
