# ADR-0004: Hexagonal architecture where the business rules are, SQL-first elsewhere

- Status: accepted

## Context
Applying ports and adapters to every module (including simple list/get endpoints) adds repositories and mappers that don't isolate any rule. The rules that matter (retry decisions, signing, circuit breaking, stale-job handling) all live in the delivery path.

## Decision
- `delivery/` is hexagonal: `domain` (pure), `application` (use case + ports), `infrastructure` (adapters), composed in `WorkerModule`.
- CRUD controllers query Postgres directly through a small helper, with zod at the boundary.

## Consequences
- The core has 98% line coverage from fast unit tests with fakes. Adapters are covered by black-box integration tests.
- If another module grows real rules (e.g. billing, quotas), it should follow the delivery module's structure.
