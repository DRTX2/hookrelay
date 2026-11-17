import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { DeliveryJob, RetryScheduler } from '../application/ports.js';

export const DELIVERY_QUEUE = 'deliveries';

@Injectable()
export class DeliveryQueue implements RetryScheduler {
  constructor(@InjectQueue(DELIVERY_QUEUE) private readonly queue: Queue<DeliveryJob>) {}

  /**
   * jobId = delivery + attempt number, so the sweeper and a racing worker can never
   * schedule the same attempt twice. Jobs are removed once done: Postgres keeps the history.
   */
  async schedule(jobs: DeliveryJob[], delayMs = 0): Promise<void> {
    await this.queue.addBulk(jobs.map((data) => ({
      name: 'deliver',
      data,
      opts: {
        jobId: `${data.deliveryId}_${data.attempt}${data.manual ? '_m' + Date.now() : ''}`,
        delay: delayMs,
        removeOnComplete: true,
        removeOnFail: 1000,
      },
    })));
  }

  counts() {
    return this.queue.getJobCounts('waiting', 'delayed', 'active', 'failed');
  }
}
