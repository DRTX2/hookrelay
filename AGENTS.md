# Instructions for AI coding agents

Read `docs/CONTEXT.md` before changing anything. It lists the decisions and traps that matter.

## Workflow (spec-driven)
1. Non-trivial change → write or update a spec in `docs/specs/` from `TEMPLATE.md` first. Acceptance criteria must be testable.
2. Implement in the layer the spec names. Rules go in `delivery/domain` or `delivery/application` (no Nest, SQL or HTTP imports there).
3. Tests: a unit test per new rule, an integration test per new endpoint or flow. Never weaken an assertion to make a test pass.
4. Run before declaring done:
   ```bash
   pnpm --filter api lint && pnpm --filter api typecheck && pnpm --filter api test:cov && pnpm --filter api test:int
   ```
5. Update docs: ARCHITECTURE if the shape changed, an ADR for any trade-off, RUNBOOK and alerts for new failure modes, and the log in CONTEXT.md.

## Conventions
- ESM + `NodeNext`: relative imports end in `.js`.
- Validation only with zod schemas from `src/contracts.ts`. They also feed OpenAPI, so never hand-write spec paths for validated bodies.
- SQL is written by hand with parameters (`$1…`). Never interpolate user input. Every tenant query filters by `app_id`.
- Logging through Nest `Logger` only (`no-console` is an error). Never log payloads, keys or secrets.
- New env vars: document them in `.env.example`, `docker-compose.yml` and `infra/terraform/ecs.tf`.
- Comments explain *why*, not what. Shortcuts get `// shortcut: <limit>, <when to upgrade>`.

## Don't
- Don't store delivery state in BullMQ, follow redirects in the sender, or check SSRF before `fetch` instead of in the agent.
- Don't add dependencies for a few lines of code.
- Don't run the integration suite against a non-`_test` database (it refuses, and that's intended).
