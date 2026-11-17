import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Job } from 'bullmq';
import { fetch } from 'undici';
import { PG, type Db } from '../db/db.js';
import { EventsService } from '../common/events.js';
import { parseSchedule, retryDelayMs } from './backoff.js';
import { DELIVERY_QUEUE, DeliveryQueue, type DeliveryJob } from './delivery.queue.js';
import { signedHeaders } from './signing.js';
import { createSafeAgent } from './ssrf.js';

const schedule = parseSchedule(process.env.RETRY_SCHEDULE);
const DISABLE_AFTER = Number(process.env.ENDPOINT_DISABLE_AFTER ?? 30);
const TIMEOUT_MS = 15_000;
const MAX_STORED_BODY = 2048;

export type Outcome =
  | { kind: 'success' }
  | { kind: 'gone' }       // 410: receiver told us to stop
  | { kind: 'retry'; delayMs: number }
  | { kind: 'exhausted' };

/** Pure decision table, unit tested. */
export function decide(statusCode: number | null, attemptNo: number, manual: boolean, sched = schedule): Outcome {
  if (statusCode !== null && statusCode >= 200 && statusCode < 300) return { kind: 'success' };
  if (statusCode === 410) return { kind: 'gone' };
  if (manual || attemptNo >= sched.length + 1) return { kind: 'exhausted' };
  return { kind: 'retry', delayMs: retryDelayMs(attemptNo, sched) };
}

@Processor(DELIVERY_QUEUE, { concurrency: Number(process.env.WORKER_CONCURRENCY ?? 50) })
export class DeliveryProcessor extends WorkerHost implements OnModuleDestroy {
  private readonly log = new Logger('Delivery');
  private readonly agent = createSafeAgent(process.env.ALLOW_PRIVATE_TARGETS === 'true');

  constructor(
    @Inject(PG) private readonly db: Db,
    private readonly queue: DeliveryQueue,
    private readonly events: EventsService,
  ) {
    super();
  }

  async process(job: Job<DeliveryJob>): Promise<void> {
    const { deliveryId, attempt, manual = false } = job.data;
    const { rows } = await this.db.query(
      `SELECT d.status, d.attempt_count, d.message_id, d.endpoint_id,
              e.url, e.secret, e.disabled_at, e.app_id,
              m.event_type, m.payload, m.created_at AS message_created_at
         FROM deliveries d
         JOIN endpoints e ON e.id = d.endpoint_id
         JOIN messages m ON m.id = d.message_id
        WHERE d.id = $1`,
      [deliveryId],
    );
    const d = rows[0];
    // Stale or duplicate job (sweeper race, manual retry already ran, row deleted): nothing to do.
    if (!d || d.status !== 'pending' || d.attempt_count + 1 !== attempt) return;

    if (d.disabled_at) {
      await this.db.query(
        `UPDATE deliveries SET status='failed', last_error='Endpoint disabled', next_attempt_at=NULL, updated_at=now() WHERE id=$1`,
        [deliveryId],
      );
      return;
    }

    const body = JSON.stringify({ type: d.event_type, timestamp: d.message_created_at, data: d.payload });
    const started = performance.now();
    let statusCode: number | null = null;
    let responseBody: string | null = null;
    let error: string | null = null;
    try {
      const res = await fetch(d.url, {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Hookrelay/1.0',
          ...signedHeaders(d.secret, d.message_id, body),
        },
        redirect: 'manual', // following redirects would bypass the SSRF check on the original URL
        dispatcher: this.agent,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      statusCode = res.status;
      responseBody = (await res.text()).slice(0, MAX_STORED_BODY);
    } catch (e) {
      const err = e as Error & { cause?: Error };
      error = (err.cause?.message ?? err.message).slice(0, 500);
    }
    const durationMs = Math.round(performance.now() - started);
    const outcome = decide(statusCode, attempt, manual);
    const lastError = error ?? (outcome.kind === 'success' ? null : `HTTP ${statusCode}`);

    const status = outcome.kind === 'success' ? 'succeeded' : outcome.kind === 'retry' ? 'pending' : 'failed';
    const nextAt = outcome.kind === 'retry' ? new Date(Date.now() + outcome.delayMs) : null;

    await this.db.query(
      `WITH a AS (
         INSERT INTO attempts (delivery_id, attempt_no, status_code, duration_ms, response_body, error)
         VALUES ($1, $2, $3, $4, $5, $6)
       )
       UPDATE deliveries SET status=$7, attempt_count=$2, next_attempt_at=$8, last_error=$9, updated_at=now()
        WHERE id=$1`,
      [deliveryId, attempt, statusCode, durationMs, responseBody, error, status, nextAt, lastError],
    );
    await this.updateCircuit(d.endpoint_id, outcome);

    if (outcome.kind === 'retry') await this.queue.enqueue([{ deliveryId, attempt: attempt + 1 }], outcome.delayMs);

    this.events.publish({
      appId: d.app_id, deliveryId, messageId: d.message_id, endpointId: d.endpoint_id,
      status, attemptNo: attempt, statusCode, durationMs, at: new Date().toISOString(),
    });
    this.log.debug(`${deliveryId} #${attempt} -> ${statusCode ?? error} (${outcome.kind})`);
  }

  /** Circuit breaker: a long run of failed attempts (or a 410) disables the endpoint. */
  private async updateCircuit(endpointId: string, outcome: Outcome) {
    if (outcome.kind === 'success') {
      await this.db.query('UPDATE endpoints SET failure_streak=0 WHERE id=$1 AND failure_streak<>0', [endpointId]);
      return;
    }
    await this.db.query(
      `UPDATE endpoints
          SET failure_streak = failure_streak + 1,
              disabled_at = CASE WHEN $2 OR failure_streak + 1 >= $3 THEN COALESCE(disabled_at, now()) ELSE disabled_at END,
              disabled_reason = CASE WHEN $2 THEN 'Receiver returned 410 Gone'
                                     WHEN failure_streak + 1 >= $3 THEN 'Too many consecutive failures'
                                     ELSE disabled_reason END
        WHERE id=$1`,
      [endpointId, outcome.kind === 'gone', DISABLE_AFTER],
    );
  }

  async onModuleDestroy() {
    await this.agent.close();
  }
}
