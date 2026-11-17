import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { DeliveryJob } from '../application/ports.js';
import { DeliverAttempt } from '../application/deliver-attempt.js';
import { metrics } from '../../common/metrics.js';
import { DELIVERY_QUEUE } from './delivery.queue.js';

/** Driving adapter: BullMQ job -> use case. Everything interesting lives in DeliverAttempt. */
@Processor(DELIVERY_QUEUE, { concurrency: Number(process.env.WORKER_CONCURRENCY ?? 50) })
export class DeliveryProcessor extends WorkerHost {
  private readonly log = new Logger('Delivery');

  constructor(private readonly deliverAttempt: DeliverAttempt) {
    super();
  }

  async process(job: Job<DeliveryJob>): Promise<void> {
    const r = await this.deliverAttempt.execute(job.data);
    metrics.attempts.inc({ outcome: r.kind });
    if ('result' in r) {
      metrics.attemptDuration.observe({ outcome: r.kind }, r.result.durationMs / 1000);
      this.log.debug(`${job.data.deliveryId} #${job.data.attempt} -> ${r.result.statusCode ?? r.result.error} (${r.kind})`);
    }
  }
}
