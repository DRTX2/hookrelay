import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';

export const DELIVERY_QUEUE = 'deliveries';

export interface DeliveryJob {
  deliveryId: string;
  attempt: number;
  manual?: boolean;
}

@Injectable()
export class DeliveryQueue {
  constructor(@InjectQueue(DELIVERY_QUEUE) private readonly queue: Queue<DeliveryJob>) {}

  /**
   * jobId = delivery + attempt number, so the sweeper and a racing worker can never
   * schedule the same attempt twice. Jobs are removed once done: Postgres keeps the history.
   */
  async enqueue(jobs: DeliveryJob[], delayMs = 0): Promise<void> {
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
}
