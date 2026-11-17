import { Inject, Injectable } from '@nestjs/common';
import { PG, type Db } from '../../db/db.js';
import type { AttemptRecord, DeliveryContext, DeliveryStore } from '../application/ports.js';

const DISABLE_AFTER = Number(process.env.ENDPOINT_DISABLE_AFTER ?? 30);

@Injectable()
export class PgDeliveryStore implements DeliveryStore {
  constructor(@Inject(PG) private readonly db: Db) {}

  async load(deliveryId: string): Promise<DeliveryContext | null> {
    const { rows } = await this.db.query(
      `SELECT d.id AS "deliveryId", d.status, d.attempt_count AS "attemptCount", d.message_id AS "messageId",
              d.endpoint_id AS "endpointId", e.app_id AS "appId", e.url, e.secret,
              e.disabled_at IS NOT NULL AS "endpointDisabled",
              m.event_type AS "eventType", m.payload, m.created_at AS "messageCreatedAt"
         FROM deliveries d
         JOIN endpoints e ON e.id = d.endpoint_id
         JOIN messages m ON m.id = d.message_id
        WHERE d.id = $1`,
      [deliveryId],
    );
    return rows[0] ?? null;
  }

  async failBecauseEndpointDisabled(deliveryId: string): Promise<void> {
    await this.db.query(
      `UPDATE deliveries SET status='failed', last_error='Endpoint disabled', next_attempt_at=NULL, updated_at=now() WHERE id=$1`,
      [deliveryId],
    );
  }

  /**
   * One statement, one commit per attempt: attempt row + delivery state + circuit breaker.
   * The endpoint row is only touched when the circuit actually changes (any failure, or the first
   * success after failures), so healthy endpoints never become a hot row under load.
   */
  async recordAttempt(r: AttemptRecord): Promise<void> {
    await this.db.query(
      `WITH a AS (
         INSERT INTO attempts (delivery_id, attempt_no, status_code, duration_ms, response_body, error)
         VALUES ($1, $2, $3, $4, $5, $6)
       ), d AS (
         UPDATE deliveries SET status=$7, attempt_count=$2, next_attempt_at=$8, last_error=$9, updated_at=now()
          WHERE id=$1
       )
       UPDATE endpoints
          SET failure_streak  = CASE WHEN $11 = 'success' THEN 0 ELSE failure_streak + 1 END,
              disabled_at     = CASE WHEN $11 = 'gone' OR ($11 <> 'success' AND failure_streak + 1 >= $12)
                                     THEN COALESCE(disabled_at, now()) ELSE disabled_at END,
              disabled_reason = CASE WHEN $11 = 'gone' THEN 'Receiver returned 410 Gone'
                                     WHEN $11 <> 'success' AND failure_streak + 1 >= $12 THEN 'Too many consecutive failures'
                                     ELSE disabled_reason END
        WHERE id = $10 AND ($11 <> 'success' OR failure_streak <> 0)`,
      [r.deliveryId, r.attempt, r.result.statusCode, r.result.durationMs, r.result.responseBody, r.result.error,
        r.status, r.nextAttemptAt, r.lastError, r.endpointId, r.outcome, DISABLE_AFTER],
    );
  }
}
