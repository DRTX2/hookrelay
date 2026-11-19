import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  Body, Controller, Headers, HttpCode, Inject, NotFoundException, Param, ParseUUIDPipe, Post, Req, UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { PG, type Db } from '../db/db.js';
import { Zod } from '../common/http.js';
import { DeliveryQueue } from '../delivery/infrastructure/delivery.queue.js';
import { ingestMessage } from './ingest.js';

const TOLERANCE_SECONDS = 300;

/** Nimbus signs `t=<unix>,v1=<hex>` = HMAC-SHA256(secret, "<unix>.<raw body>"); several v1 allow rotation. */
export function verifyNimbusSignature(secret: string, header: string | undefined, rawBody: Buffer, now = Date.now()): boolean {
  if (!secret || !header) return false;
  const parts = header.split(',').map((p) => p.trim());
  const t = Number(parts.find((p) => p.startsWith('t='))?.slice(2));
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  return parts.filter((p) => p.startsWith('v1=')).some((p) => {
    const got = Buffer.from(p.slice(3), 'hex');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

const NimbusIncident = z.looseObject({ incidentId: z.string().min(1).max(100), event: z.enum(['opened', 'recovered', 'escalated']) });

/**
 * Atalaya integration: Nimbus incident workflows post here (Nimbus HTTP steps cannot carry an API
 * key, so the request is authenticated by its HMAC signature instead). The incident becomes a normal
 * Hookrelay message (`incident.opened` / `incident.recovered` / `incident.escalated`) and gets signed delivery, retries,
 * DLQ and replay for free. Idempotent per incident + event, so Nimbus' at-least-once retries are safe.
 */
@Controller('v1/inbound/nimbus')
export class InboundController {
  constructor(@Inject(PG) private readonly db: Db, private readonly queue: DeliveryQueue) {}

  @Post(':appId')
  @HttpCode(202)
  async nimbus(
    @Param('appId', ParseUUIDPipe) appId: string,
    @Headers('nimbus-signature') signature: string | undefined,
    @Req() req: Request & { rawBody?: Buffer },
    @Body(new Zod(NimbusIncident)) incident: z.infer<typeof NimbusIncident>,
  ) {
    if (!verifyNimbusSignature(process.env.NIMBUS_WEBHOOK_SECRET ?? '', signature, req.rawBody ?? Buffer.alloc(0))) {
      throw new UnauthorizedException('Invalid Nimbus signature');
    }
    const app = await this.db.query('SELECT 1 FROM apps WHERE id=$1', [appId]);
    if (!app.rowCount) throw new NotFoundException();
    return ingestMessage(this.db, this.queue, appId, `incident.${incident.event}`, incident, `nimbus:${incident.incidentId}:${incident.event}`);
  }
}
