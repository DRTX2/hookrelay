# Spec 001: Wildcard event type subscriptions

- Status: ready for implementation
- Owner: unassigned
- Related: ROADMAP #3

## Problem
Endpoints subscribe to an exact list of event types (`order.created`, `order.paid`, …). Customers who want "everything about orders" must update their subscription whenever a new `order.*` event is added, and they miss events in the meantime.

## Behaviour
- `eventTypes` entries may end in `.*`: `order.*` matches `order.created` and `order.item.added`, but not `orders.created` or `order`.
- `*` alone is not allowed. Omitting `eventTypes` already means "all".
- Exact entries keep working unchanged. Mixed lists are allowed: `["order.*", "user.deleted"]`.

## Contract changes
- `contracts.ts`: `EventType` for subscriptions becomes `/^([\w-]+\.)*([\w-]+|\*)$/` with the extra rule that `*` only appears as the last segment and at least one segment precedes it. Message `eventType` stays exact (no wildcards when sending).
- OpenAPI regenerates automatically. Update the field description.

## Implementation notes
- Matching happens in the fan-out `INSERT … SELECT` in `messages.controller.ts`. Option A (preferred): store wildcard prefixes in a separate `event_prefixes text[]` column (migration `002`) and match with `event_types IS NULL OR $3 = ANY(event_types) OR EXISTS (SELECT 1 FROM unnest(event_prefixes) p WHERE $3 LIKE p || '.%')`.
- Keep the matcher logic as a pure function in a new `domain/event-matching.ts` as well, unit-tested and reused by the dashboard preview.
- Index: none needed at current scale (endpoints per tenant are few). Revisit if a tenant has >10k endpoints.

## Acceptance criteria
1. `order.*` endpoint receives `order.created` and `order.item.added`, and does not receive `orders.created` or `invoice.paid` (integration test).
2. Invalid patterns (`*`, `order.*.x`, `.*`) return 400 with a clear message (unit + integration).
3. Existing exact subscriptions behave exactly as before (existing tests stay green).
4. Dashboard endpoint form accepts and displays wildcards.
5. Docs: README feature list and OpenAPI description updated.
