import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException, type CanActivate, createParamDecorator, type ExecutionContext,
  Inject, Injectable, type PipeTransform, UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { ZodType } from 'zod';
import { PG, type Db } from '../db/db.js';

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
export const newApiKey = () => 'hr_' + randomBytes(24).toString('base64url');

type TenantRequest = Request & { tenantId?: string };

/** Resolves `Authorization: Bearer hr_...` to an app id. Keys are stored hashed only. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(PG) private readonly db: Db) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<TenantRequest>();
    const key = req.headers.authorization?.match(/^Bearer (hr_[\w-]+)$/)?.[1];
    if (!key) throw new UnauthorizedException('Missing API key');
    const { rows } = await this.db.query('SELECT id FROM apps WHERE api_key_hash = $1', [hashKey(key)]);
    if (!rows[0]) throw new UnauthorizedException('Invalid API key');
    req.tenantId = rows[0].id;
    return true;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const given = Buffer.from(String(ctx.switchToHttp().getRequest<Request>().headers['x-admin-token'] ?? ''));
    const expected = Buffer.from(process.env.ADMIN_TOKEN ?? '');
    if (!expected.length || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}

export const Tenant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<TenantRequest>().tenantId!,
);

export class Zod<T> implements PipeTransform {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`));
    return r.data;
  }
}
