import { tx, type Db } from '../db/db.js';
import { metrics } from '../common/metrics.js';
import type { DeliveryQueue } from '../delivery/infrastructure/delivery.queue.js';

export interface IngestResult {
  id: string;
  fanout: number;
  duplicate: boolean;
}

/**
 * Accept one event for a tenant and fan it out. Shared by the public API and signed inbound
 * integrations so both get the same guarantees: one transaction for message + deliveries,
 * idempotency by key, enqueue after COMMIT (the sweeper covers a failed enqueue).
 */
export async function ingestMessage(
  db: Db, queue: DeliveryQueue, appId: string, eventType: string, payload: unknown, idemKey?: string,
): Promise<IngestResult> {
  const result = await tx(db, async (c) => {
    const inserted = await c.query(
      `INSERT INTO messages (app_id, event_type, payload, idempotency_key) VALUES ($1,$2,$3,$4)
       ON CONFLICT (app_id, idempotency_key) DO NOTHING RETURNING id`,
      [appId, eventType, payload, idemKey ?? null],
    );
    if (!inserted.rows[0]) {
      const existing = await c.query(
        `SELECT m.id, count(d.*)::int AS n FROM messages m LEFT JOIN deliveries d ON d.message_id = m.id
          WHERE m.app_id=$1 AND m.idempotency_key=$2 GROUP BY m.id`,
        [appId, idemKey],
      );
      return { id: existing.rows[0].id as string, deliveryIds: [] as string[], fanout: existing.rows[0].n as number, duplicate: true };
    }
    const id = inserted.rows[0].id as string;
    const deliveries = await c.query(
      `INSERT INTO deliveries (message_id, endpoint_id, next_attempt_at)
       SELECT $1, id, now() FROM endpoints
        WHERE app_id=$2 AND disabled_at IS NULL AND (event_types IS NULL OR $3 = ANY(event_types))
       RETURNING id`,
      [id, appId, eventType],
    );
    const deliveryIds = deliveries.rows.map((r) => r.id as string);
    return { id, deliveryIds, fanout: deliveryIds.length, duplicate: false };
  });

  // After COMMIT: if this fails the rows are still 'pending' and the sweeper enqueues them.
  if (result.deliveryIds.length) {
    await queue.schedule(result.deliveryIds.map((deliveryId) => ({ deliveryId, attempt: 1 }))).catch(() => {});
  }
  metrics.messages.inc({ duplicate: String(result.duplicate) });
  return { id: result.id, fanout: result.fanout, duplicate: result.duplicate };
}
