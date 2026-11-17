import {
  BadRequestException, Body, Controller, Delete, Get, HttpCode, Inject, NotFoundException,
  Param, ParseUUIDPipe, Post, UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { PG, type Db } from '../db/db.js';
import { ApiKeyGuard, Tenant, Zod } from '../common/http.js';
import { generateSecret } from '../delivery/signing.js';
import { assertSafeUrl, UnsafeTargetError } from '../delivery/ssrf.js';

const CreateEndpoint = z.object({
  url: z.string().max(2048),
  description: z.string().max(200).optional(),
  eventTypes: z.array(z.string().regex(/^[\w.-]{1,100}$/)).max(50).optional(),
});

const COLUMNS = `e.id, e.url, e.description, e.event_types AS "eventTypes", e.failure_streak AS "failureStreak",
  e.disabled_at AS "disabledAt", e.disabled_reason AS "disabledReason", e.created_at AS "createdAt"`;

@Controller('v1/endpoints')
@UseGuards(ApiKeyGuard)
export class EndpointsController {
  constructor(@Inject(PG) private readonly db: Db) {}

  @Get()
  async list(@Tenant() appId: string) {
    const { rows } = await this.db.query(
      `SELECT ${COLUMNS},
              count(d.*) FILTER (WHERE d.status = 'succeeded')::int AS "succeeded24h",
              count(d.*) FILTER (WHERE d.status = 'failed')::int    AS "failed24h",
              count(d.*) FILTER (WHERE d.status = 'pending')::int   AS "pending"
         FROM endpoints e
         LEFT JOIN deliveries d ON d.endpoint_id = e.id AND d.created_at > now() - interval '24 hours'
        WHERE e.app_id = $1
        GROUP BY e.id ORDER BY e.created_at DESC`,
      [appId],
    );
    return rows;
  }

  @Post()
  async create(@Tenant() appId: string, @Body(new Zod(CreateEndpoint)) body: z.infer<typeof CreateEndpoint>) {
    try {
      assertSafeUrl(body.url, process.env.ALLOW_PRIVATE_TARGETS === 'true');
    } catch (e) {
      if (e instanceof UnsafeTargetError) throw new BadRequestException(e.message);
      throw e;
    }
    const { rows } = await this.db.query(
      `INSERT INTO endpoints (app_id, url, description, secret, event_types) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, url, description, secret, event_types AS "eventTypes", created_at AS "createdAt"`,
      [appId, body.url, body.description ?? null, generateSecret(), body.eventTypes?.length ? body.eventTypes : null],
    );
    return rows[0];
  }

  @Get(':id')
  async get(@Tenant() appId: string, @Param('id', ParseUUIDPipe) id: string) {
    const { rows } = await this.db.query(`SELECT ${COLUMNS}, e.secret FROM endpoints e WHERE e.id=$1 AND e.app_id=$2`, [id, appId]);
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }

  @Post(':id/enable')
  @HttpCode(204)
  async enable(@Tenant() appId: string, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.db.query(
      `UPDATE endpoints SET disabled_at=NULL, disabled_reason=NULL, failure_streak=0 WHERE id=$1 AND app_id=$2`,
      [id, appId],
    );
    if (!r.rowCount) throw new NotFoundException();
  }

  @Post(':id/disable')
  @HttpCode(204)
  async disable(@Tenant() appId: string, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.db.query(
      `UPDATE endpoints SET disabled_at=COALESCE(disabled_at, now()), disabled_reason='Disabled manually' WHERE id=$1 AND app_id=$2`,
      [id, appId],
    );
    if (!r.rowCount) throw new NotFoundException();
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Tenant() appId: string, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.db.query('DELETE FROM endpoints WHERE id=$1 AND app_id=$2', [id, appId]);
    if (!r.rowCount) throw new NotFoundException();
  }
}
