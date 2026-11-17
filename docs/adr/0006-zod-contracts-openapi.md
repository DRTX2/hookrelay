# ADR-0006: zod schemas are the API contract; OpenAPI is generated from them

- Status: accepted

## Context
Hand-written OpenAPI drifts from the real validation. Decorator-based generators (`@nestjs/swagger`) duplicate the schema in classes.

## Decision
Request schemas live in `src/contracts.ts`. Controllers validate with them, and `src/openapi.ts` turns the same schemas into an OpenAPI 3.1 document (`z.toJSONSchema`), served at `/openapi.json` and rendered with Scalar at `/docs`.

## Consequences
- One place to change a contract. An integration test asserts that the published spec contains the validated fields.
- Response schemas aren't generated yet (ROADMAP).
