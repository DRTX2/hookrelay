import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { metrics } from './metrics.js';

const log = new Logger('HTTP');

/** Correlation id + one structured line per request + latency histogram. Never logs bodies or keys. */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const id = (req.headers['x-request-id'] as string | undefined)?.slice(0, 100) || randomUUID();
  res.setHeader('x-request-id', id);
  const started = performance.now();
  res.on('finish', () => {
    const ms = performance.now() - started;
    const route = (req.route?.path as string | undefined) ?? 'unmatched'; // templated path keeps label cardinality low
    metrics.httpRequests.observe({ method: req.method, route, status: String(res.statusCode) }, ms / 1000);
    if (req.path === '/health' || req.path === '/metrics') return;
    log.log({ requestId: id, method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) });
  });
  next();
}
