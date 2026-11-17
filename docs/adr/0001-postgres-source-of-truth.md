# ADR-0001: PostgreSQL is the source of truth; the queue only carries "attempt N is due"

- Status: accepted
- Date: 2026-11

## Context
Delivery state could live in the queue (BullMQ's `attempts` + backoff) or in the database. Keeping it in both means two attempt counters that drift apart, especially with manual resends and several worker replicas.

## Decision
Postgres holds all delivery state (`deliveries.status`, `attempt_count`, `next_attempt_at`, `attempts` history). BullMQ jobs are disposable triggers `{ deliveryId, attempt }` with deterministic IDs (`deliveryId_attempt`). Each retry is a new delayed job, scheduled only **after** the attempt is persisted.

## Consequences
- A worker can crash at any point and nothing is lost: the sweeper rebuilds the queue from `pending` rows.
- A stale or duplicate job is detected cheaply (`attempt != attempt_count + 1`) and skipped.
- Redis can be flushed in an incident without losing data (only latency).
- Cost: one extra DB read per attempt. That's acceptable; see SCALABILITY for numbers.
