import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { filter, Observable, share } from 'rxjs';
import { required } from '../db/db.js';

export interface DeliveryEvent {
  appId: string;
  deliveryId: string;
  messageId: string;
  endpointId: string;
  status: 'pending' | 'succeeded' | 'failed';
  attemptNo: number;
  statusCode: number | null;
  durationMs: number;
  at: string;
}

const CHANNEL = 'hookrelay:delivery-events';

/**
 * Workers publish, every API instance subscribes. Redis pub/sub keeps SSE working when
 * the API is scaled horizontally; it is fire-and-forget, the database stays the source of truth.
 */
@Injectable()
export class EventsService implements OnModuleDestroy {
  private pub?: Redis;
  private sub?: Redis;
  private stream$?: Observable<DeliveryEvent>;

  publish(event: DeliveryEvent): void {
    this.pub ??= new Redis(required('REDIS_URL'));
    this.pub.publish(CHANNEL, JSON.stringify(event)).catch(() => {});
  }

  forApp(appId: string): Observable<DeliveryEvent> {
    this.stream$ ??= new Observable<DeliveryEvent>((subscriber) => {
      this.sub = new Redis(required('REDIS_URL'));
      this.sub.subscribe(CHANNEL);
      this.sub.on('message', (_, raw) => subscriber.next(JSON.parse(raw)));
      return () => { this.sub?.disconnect(); this.sub = undefined; };
    }).pipe(share());
    return this.stream$.pipe(filter((e) => e.appId === appId));
  }

  onModuleDestroy() {
    this.pub?.disconnect();
    this.sub?.disconnect();
  }
}
