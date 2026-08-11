# Quant Platform Upgrade Implementation Plan

1. Add market calendar and annualization modules with VN/crypto/XAU tests; route data-quality and performance calculations through them.
2. Add a versioned FastAPI quant-engine contract and `skfolio` optimizer with deterministic constraints, 70/30 IS/OOS metrics and Next.js client tests.
3. Replace the npm optimizer call, preserve the optimizer UI response shape, expose IS/OOS diagnostics, and remove `portfolio-allocation` after parity tests.
4. Add QuantStats-compatible analytics and self-contained HTML report artifacts to single-asset and portfolio backtests.
5. Add five `talipp` strategies, synchronize Python/TypeScript catalogs and validate causal execution.
6. Evaluate active strategy assignments after immutable dataset publication and persist deduplicated BUY/SELL suggestions.
7. Add CCXT OHLCV fallback for crypto with typed provenance and fallback-only tests.
8. Add Factor Lab readiness API/UI and point-in-time momentum, volatility, trend and liquidity rankings for eligible VN daily datasets.
9. Install locked Python dependencies in a project virtual environment; run Python, Vitest, lint, Prisma and production-build gates.
10. Commit the feature branch, merge to local `main`, rebuild, and restart the app and quant engine on stable local ports.
