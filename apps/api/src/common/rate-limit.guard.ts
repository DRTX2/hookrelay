import { type CanActivate, type ExecutionContext, HttpException, HttpStatus, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Redis } from 'ioredis';
import { required } from '../db/db.js';

const LIMIT = Number(process.env.RATE_LIMIT_PER_MINUTE ?? 600);

/**
 * Per-tenant fixed-window limit on ingestion (OWASP API4: unrestricted resource consumption).
 * Shared through Redis so it holds across API replicas. Runs after ApiKeyGuard (needs tenantId).
 * shortcut: fixed window allows a 2x burst at the window edge; move to a sliding window/token bucket if that matters.
 */
@Injectable()
export class RateLimitGuard implements CanActivate, OnModuleDestroy {
  private redis?: Redis;

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { tenantId?: string }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    this.redis ??= new Redis(required('REDIS_URL'));
    const window = Math.floor(Date.now() / 60_000);
    const key = `hookrelay:rl:${req.tenantId}:${window}`;
    const [[, count]] = (await this.redis.multi().incr(key).expire(key, 61).exec()) as [[null, number]];
    res.setHeader('ratelimit-limit', LIMIT);
    res.setHeader('ratelimit-remaining', Math.max(0, LIMIT - count));
    if (count > LIMIT) {
      res.setHeader('retry-after', 60 - (Math.floor(Date.now() / 1000) % 60));
      throw new HttpException('Rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  onModuleDestroy() {
    this.redis?.disconnect();
  }
}
