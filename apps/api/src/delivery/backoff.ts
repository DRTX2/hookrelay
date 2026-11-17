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
