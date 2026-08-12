# Custom strategy and forward-testing QA — 2026-08-12

## Verified

- Local PostgreSQL migration `202608120003_active_strategy_assignment_unique` applied; Prisma reports 16 migrations and schema up to date.
- Custom Price Threshold and Scheduled DCA backtests execute causally with immutable rule hashes.
- Dataset publication creates durable, idempotent evaluation jobs instead of synchronous signals.
- Worker processes at most one Quant Run and one evaluation job per loop.
- Activation creates an initial snapshot and does not import historical trades or send an initial notification.
- Forward signals, snapshots, notification reads, and mark-read operations are tenant/user scoped.
- Header notification center and Mock Portfolio forward-test chart are implemented.
- Focused Python worker suite: 23 passed.
- Focused TypeScript forward suite: 11 passed; focused ESLint passed.
- Webpack production build compiled successfully; the command timed out during TypeScript validation at 126 seconds.

## Known gates before release

- Default Turbopack build cannot follow the worktree `node_modules` symlink outside its filesystem root; run the final production build from the merged main checkout.
- Full TypeScript validation is blocked only by pre-existing/in-progress fixtures in `asset-client.test.ts` and `builder-state.test.ts`; the forward-testing files have no remaining TypeScript errors.
- Browser session is signed out locally, so authenticated Quant Lab and Portfolio visual QA still requires a local sign-in.
- A distinct `TEST_DATABASE_URL` is not configured. Do not alias it to the development database; database integration tests must use an isolated database ending in `_test`.
