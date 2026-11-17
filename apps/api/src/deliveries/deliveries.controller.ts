import {
  Body, ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe,
  Post, Query, Sse, UseGuards, type MessageEvent,
} from '@nestjs/common';
import { interval, map, merge, type Observable } from 'rxjs';
import { PG, type Db } from '../db/db.js';
import { AdminGuard, ApiKeyGuard, hashKey, newApiKey, Tenant, Zod } from '../common/http.js';
import { EventsService } from '../common/events.js';
import { CreateApp, ListDeadLettersQuery, ReplayDeadLetters } from '../contracts.js';
import { DeliveryQueue } from '../delivery/infrastructure/delivery.queue.js';

@Controller('v1')
export class DeliveriesController {
  constructor(
    @Inject(PG) private readonly db: Db,
    private readonly queue: DeliveryQueue,
    private readonly events: EventsService,
  ) {}

  /** Manual resend of a failed delivery: one extra attempt, no automatic retries after it. */
  @Post('deliveries/:id/retry')
  @UseGuards(ApiKeyGuard)
  @HttpCode(202)
  async retry(@Tenant() appId: string, @Param('id', ParseUUIDPipe) id: string) {
    const { rows } = await this.db.query(
      `UPDATE deliveries d SET status='pending', next_attempt_at=now(), updated_at=now()
         FROM endpoints e
        WHERE d.id=$1 AND e.id=d.endpoint_id AND e.app_id=$2 AND d.status='failed'
       RETURNING d.attempt_count`,
      [id, appId],
    );
    if (!rows[0]) {
      const exists = await this.db.query(
        'SELECT 1 FROM deliveries d JOIN endpoints e ON e.id=d.endpoint_id WHERE d.id=$1 AND e.app_id=$2', [id, appId],
      );
      if (!exists.rowCount) throw new NotFoundException();
      throw new ConflictException('Only failed deliveries can be retried');
    }
    await this.queue.schedule([{ deliveryId: id, attempt: rows[0].attempt_count + 1, manual: true }]);
    return { id, status: 'pending' };
  }

  /** Dead-letter queue: failed deliveries, newest first, with enough context to decide on a replay. */
  @Get('dead-letters')
  @UseGuards(ApiKeyGuard)
  async deadLetters(@Tenant() appId: string, @Query(new Zod(ListDeadLettersQuery)) q: ListDeadLettersQuery) {
    const { rows } = await this.db.query(
      `SELECT d.id, d.attempt_count AS "attemptCount", d.last_error AS "lastError", d.updated_at AS "failedAt",
              m.id AS "messageId", m.event_type AS "eventType", e.id AS "endpointId", e.url AS "endpointUrl"
         FROM deliveries d
         JOIN endpoints e ON e.id = d.endpoint_id
         JOIN messages m ON m.id = d.message_id
        WHERE e.app_id=$1 AND d.status='failed'
          AND ($2::uuid IS NULL OR e.id=$2) AND ($3::timestamptz IS NULL OR d.updated_at < $3)
        ORDER BY d.updated_at DESC LIMIT $4`,
      [appId, q.endpointId ?? null, q.before ?? null, q.limit],
    );
    const total = await this.db.query(
      `SELECT count(*)::int AS n FROM deliveries d JOIN endpoints e ON e.id=d.endpoint_id
        WHERE e.app_id=$1 AND d.status='failed' AND ($2::uuid IS NULL OR e.id=$2)`,
      [appId, q.endpointId ?? null],
    );
    return { data: rows, total: total.rows[0].n, nextCursor: rows.length === q.limit ? rows.at(-1).failedAt : null };
  }

  /**
   * Bulk replay from the dead-letter queue (e.g. after a customer fixes their endpoint).
   * Atomic claim: rows flip failed -> pending in one statement, so two concurrent replays can't double-send.
   * Each replayed delivery gets one manual attempt; if it fails again it returns to the DLQ.
   */
  @Post('dead-letters/replay')
  @UseGuards(ApiKeyGuard)
  @HttpCode(202)
  async replay(@Tenant() appId: string, @Body(new Zod(ReplayDeadLetters)) body: ReplayDeadLetters) {
    const { rows } = await this.db.query(
      `UPDATE deliveries d SET status='pending', next_attempt_at=now(), updated_at=now()
        WHERE d.id IN (
          SELECT d2.id FROM deliveries d2 JOIN endpoints e ON e.id = d2.endpoint_id
           WHERE e.app_id=$1 AND d2.status='failed' AND e.disabled_at IS NULL
             AND ($2::uuid IS NULL OR e.id=$2)
             AND ($3::timestamptz IS NULL OR d2.updated_at >= $3)
             AND ($4::timestamptz IS NULL OR d2.updated_at <= $4)
           ORDER BY d2.updated_at LIMIT $5
           FOR UPDATE OF d2 SKIP LOCKED)
       RETURNING d.id, d.attempt_count`,
      [appId, body.endpointId ?? null, body.since ?? null, body.until ?? null, body.limit],
    );
    if (rows.length) {
      await this.queue.schedule(rows.map((r) => ({ deliveryId: r.id, attempt: r.attempt_count + 1, manual: true })));
    }
    return { replayed: rows.length };
  }

  @Get('stats')
  @UseGuards(ApiKeyGuard)
  async stats(@Tenant() appId: string) {
    const [totals, latency, series] = await Promise.all([
      this.db.query(
        `SELECT count(*) FILTER (WHERE d.status='succeeded')::int AS succeeded,
                count(*) FILTER (WHERE d.status='failed')::int AS failed,
                count(*) FILTER (WHERE d.status='pending')::int AS pending
           FROM deliveries d JOIN endpoints e ON e.id=d.endpoint_id
          WHERE e.app_id=$1 AND d.created_at > now() - interval '24 hours'`,
        [appId],
      ),
      this.db.query(
        `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY a.duration_ms)::int AS p50,
                percentile_cont(0.95) WITHIN GROUP (ORDER BY a.duration_ms)::int AS p95,
                count(*)::int AS attempts
           FROM attempts a JOIN deliveries d ON d.id=a.delivery_id JOIN endpoints e ON e.id=d.endpoint_id
          WHERE e.app_id=$1 AND a.created_at > now() - interval '24 hours'`,
        [appId],
      ),
      this.db.query(
        `SELECT h.bucket AS hour,
                count(a.*) FILTER (WHERE a.status_code BETWEEN 200 AND 299)::int AS ok,
                count(a.*) FILTER (WHERE a.id IS NOT NULL AND (a.status_code IS NULL OR a.status_code NOT BETWEEN 200 AND 299))::int AS err
           FROM generate_series(date_trunc('hour', now()) - interval '23 hours', date_trunc('hour', now()), interval '1 hour') AS h(bucket)
           LEFT JOIN (attempts a JOIN deliveries d ON d.id=a.delivery_id JOIN endpoints e ON e.id=d.endpoint_id AND e.app_id=$1)
             ON date_trunc('hour', a.created_at) = h.bucket
          GROUP BY h.bucket ORDER BY h.bucket`,
        [appId],
      ),
    ]);
    const t = totals.rows[0];
    const done = t.succeeded + t.failed;
    return { ...t, successRate: done ? t.succeeded / done : null, ...latency.rows[0], series: series.rows };
  }

  /** Live delivery feed. Heartbeat keeps proxies from closing idle connections. */
  @Sse('stream')
  @UseGuards(ApiKeyGuard)
  stream(@Tenant() appId: string): Observable<MessageEvent> {
    return merge(
      this.events.forApp(appId).pipe(map((data) => ({ type: 'delivery', data }) as MessageEvent)),
      interval(25_000).pipe(map(() => ({ type: 'ping', data: '' }) as MessageEvent)),
    );
  }

  /** Creates a tenant and returns its API key exactly once. */
  @Post('apps')
  @UseGuards(AdminGuard)
  async createApp(@Body(new Zod(CreateApp)) body: { name: string }) {
    const apiKey = newApiKey();
    const { rows } = await this.db.query(
      'INSERT INTO apps (name, api_key_hash) VALUES ($1, $2) RETURNING id, name, created_at AS "createdAt"',
      [body.name, hashKey(apiKey)],
    );
    return { ...rows[0], apiKey };
  }
}
