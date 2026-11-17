import { createServer } from 'node:http';
import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from 'prom-client';

/** Prometheus metrics. API serves them on GET /metrics; the worker on its own METRICS_PORT. */
export const registry = new Registry();
let queueCounts: (() => Promise<Record<string, number>>) | undefined;
collectDefaultMetrics({ register: registry, prefix: 'hookrelay_' });

export const metrics = {
  messages: new Counter({
    name: 'hookrelay_messages_ingested_total', help: 'Messages accepted by the API',
    labelNames: ['duplicate'] as const, registers: [registry],
  }),
  attempts: new Counter({
    name: 'hookrelay_delivery_attempts_total', help: 'Delivery jobs processed, by outcome',
    labelNames: ['outcome'] as const, registers: [registry],
  }),
  attemptDuration: new Histogram({
    name: 'hookrelay_delivery_attempt_duration_seconds', help: 'HTTP time spent calling receivers',
    labelNames: ['outcome'] as const, buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 15], registers: [registry],
  }),
  httpRequests: new Histogram({
    name: 'hookrelay_http_request_duration_seconds', help: 'API request latency',
    labelNames: ['method', 'route', 'status'] as const, buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5], registers: [registry],
  }),
  queueJobs: new Gauge({
    name: 'hookrelay_queue_jobs', help: 'Delivery queue size by state (sampled on scrape)',
    labelNames: ['state'] as const, registers: [registry],
    async collect() {
      if (!queueCounts) return;
      for (const [state, n] of Object.entries(await queueCounts())) this.set({ state }, n);
    },
  }),
};

/** Queue depth is the main autoscaling and alerting signal for workers. */
export function trackQueue(counts: () => Promise<Record<string, number>>) {
  queueCounts = counts;
}

export function serveMetrics(port: number) {
  return createServer(async (req, res) => {
    if (req.url !== '/metrics') return void res.writeHead(404).end();
    res.writeHead(200, { 'content-type': registry.contentType }).end(await registry.metrics());
  }).listen(port);
}
