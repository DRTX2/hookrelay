# ADR-0002: Delivery runs in a separate worker process

- Status: accepted

## Context
HTTP calls to customer endpoints are slow and unpredictable (up to the 15 s timeout). If they run in the API process, a wave of slow receivers saturates the event loop and connection pool that ingestion depends on.

## Decision
Two entrypoints built from one image: `dist/main.js` (API) and `dist/worker.js` (BullMQ consumer + sweeper). They're deployed as separate ECS services and scale independently.

## Consequences
- Ingestion latency is isolated from receiver latency. Under load tests, ingestion p95 stayed ~4 ms while workers delivered at the same rate.
- One image avoids version drift between producer and consumer of the job format. (We actually hit that drift in local compose with two separately built images, and fixed it by sharing the image.)
- Two services to operate. That's mitigated by identical config and the same CI artifact.
