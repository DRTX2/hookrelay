import {
  Body, Controller, Get, Headers, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Query, Res, UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { PG, tx, type Db } from '../db/db.js';
import { ApiKeyGuard, Tenant, Zod } from '../common/http.js';
import { RateLimitGuard } from '../common/rate-limit.guard.js';
import { metrics } from '../common/metrics.js';
import { CreateMessage, IdempotencyKey, ListMessagesQuery } from '../contracts.js';
import { DeliveryQueue } from '../delivery/infrastructure/delivery.queue.js';

@Controller('v1/messages')
@UseGuards(ApiKeyGuard)
export class MessagesController {
  constructor(@Inject(PG) private readonly db: Db, private readonly queue: DeliveryQueue) {}

  /**
   * Accept an event and fan it out to every subscribed endpoint.
   * Same Idempotency-Key => same message, no new deliveries (safe client retries).
   */
  @Post()
  @UseGuards(RateLimitGuard)
  async create(
    @Tenant() appId: string,
    @Body(new Zod(CreateMessage)) body: CreateMessage,
    @Headers('idempotency-key') rawIdemKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const idemKey = new Zod(IdempotencyKey).transform(rawIdemKey);
    const result = await tx(this.db, async (c) => {
      const inserted = await c.query(
        `INSERT INTO messages (app_id, event_type, payload, idempotency_key) VALUES ($1,$2,$3,$4)
         ON CONFLICT (app_id, idempotency_key) DO NOTHING RETURNING id, created_at`,
        [appId, body.eventType, body.payload, idemKey ?? null],
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
        [id, appId, body.eventType],
      );
      const deliveryIds = deliveries.rows.map((r) => r.id as string);
      return { id, deliveryIds, fanout: deliveryIds.length, duplicate: false };
    });

    // After COMMIT: if this fails the rows are still 'pending' and the sweeper enqueues them.
    if (result.deliveryIds.length) {
      await this.queue.schedule(result.deliveryIds.map((deliveryId) => ({ deliveryId, attempt: 1 }))).catch(() => {});
    }
    metrics.messages.inc({ duplicate: String(result.duplicate) });
    res.status(result.duplicate ? 200 : 202);
    return { id: result.id, fanout: result.fanout, duplicate: result.duplicate };
  }

  @Get()
  async list(@Tenant() appId: string, @Query(new Zod(ListMessagesQuery)) q: ListMessagesQuery) {
    const { rows } = await this.db.query(
      `SELECT m.id, m.event_type AS "eventType", m.created_at AS "createdAt",
              count(d.*)::int AS fanout,
              count(d.*) FILTER (WHERE d.status='succeeded')::int AS succeeded,
              count(d.*) FILTER (WHERE d.status='failed')::int AS failed,
              count(d.*) FILTER (WHERE d.status='pending')::int AS pending
         FROM messages m LEFT JOIN deliveries d ON d.message_id = m.id
        WHERE m.app_id=$1 AND ($2::timestamptz IS NULL OR m.created_at < $2) AND ($3::text IS NULL OR m.event_type=$3)
        GROUP BY m.id ORDER BY m.created_at DESC LIMIT $4`,
      [appId, q.before ?? null, q.eventType ?? null, q.limit],
    );
    return { data: rows, nextCursor: rows.length === q.limit ? rows.at(-1).createdAt : null };
  }

  @Get(':id')
  async get(@Tenant() appId: string, @Param('id', ParseUUIDPipe) id: string) {
    const msg = await this.db.query(
      `SELECT id, event_type AS "eventType", payload, idempotency_key AS "idempotencyKey", created_at AS "createdAt"
         FROM messages WHERE id=$1 AND app_id=$2`,
      [id, appId],
    );
    if (!msg.rows[0]) throw new NotFoundException();
    const deliveries = await this.db.query(
      `SELECT d.id, d.status, d.attempt_count AS "attemptCount", d.next_attempt_at AS "nextAttemptAt",
              d.last_error AS "lastError", e.id AS "endpointId", e.url AS "endpointUrl",
              COALESCE(json_agg(json_build_object(
                'attemptNo', a.attempt_no, 'statusCode', a.status_code, 'durationMs', a.duration_ms,
                'responseBody', a.response_body, 'error', a.error, 'createdAt', a.created_at
              ) ORDER BY a.attempt_no) FILTER (WHERE a.id IS NOT NULL), '[]') AS attempts
         FROM deliveries d
         JOIN endpoints e ON e.id = d.endpoint_id
         LEFT JOIN attempts a ON a.delivery_id = d.id
        WHERE d.message_id=$1
        GROUP BY d.id, e.id ORDER BY e.url`,
      [id],
    );
    return { ...msg.rows[0], deliveries: deliveries.rows };
  }
}
