import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { PG, type Db } from '../db/db.js';
import { DeliveryQueue } from './delivery.queue.js';

const EVERY_MS = 60_000;

/**
 * Recovers deliveries whose job never reached Redis (crash between COMMIT and enqueue,
 * Redis outage, flushed queue). Because jobIds are deterministic, re-enqueueing an attempt
 * that is still queued is a no-op, so running this on every worker replica is safe.
 */
@Injectable()
export class Sweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Sweeper');
  private timer?: NodeJS.Timeout;

  constructor(@Inject(PG) private readonly db: Db, private readonly queue: DeliveryQueue) {}

  onApplicationBootstrap() {
    this.timer = setInterval(() => this.sweep().catch((e) => this.log.error(e)), EVERY_MS);
  }

  async sweep(): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT id, attempt_count FROM deliveries
        WHERE status = 'pending' AND COALESCE(next_attempt_at, created_at) < now() - interval '2 minutes'
        ORDER BY updated_at LIMIT 500`,
    );
    if (rows.length) {
      await this.queue.enqueue(rows.map((r) => ({ deliveryId: r.id, attempt: r.attempt_count + 1 })));
      this.log.warn(`Re-enqueued ${rows.length} orphaned deliveries`);
    }
    return rows.length;
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }
}
