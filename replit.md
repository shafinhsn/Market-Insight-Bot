# Market Intel Arena

NYS government + market intelligence platform that runs a 9-agent AI pipeline to analyze live options flow, news, legislation, and political statements, then streams ranked options trading recommendations.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied at `/api`)
- `pnpm --filter @workspace/market-intel run dev` — run the frontend (port 18545, proxied at `/`)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5, esbuild (CJS bundle), Zod v4 validation
- Frontend: React + Vite, Tailwind, shadcn/ui, wouter, TanStack Query
- AI: clod.io (OpenAI-compatible) via `openai` SDK — model `claude-opus-4-5` (configurable via `AI_MODEL` env)
- DB: PostgreSQL + Drizzle ORM

## Where things live

- `artifacts/api-server/src/services/` — all data-fetch + AI services
  - `ai-client.ts` — clod.io OpenAI-compatible client
  - `finnhub.ts` — live options flow via Finnhub
  - `yahoo-finance.ts` — options flow + historical prices
  - `stock-prices.ts` — batch stock price fetch
  - `news-feed.ts` — NewsAPI + RSS fallback
  - `bills.ts` — Congress.gov + OpenStates + GovTrack fallback
  - `gdelt.ts` — political statements (Trump, Powell, Musk, Bessent, Yellen)
  - `fec.ts` — FEC campaign finance
  - `multi-agent.ts` — 9-agent orchestration pipeline
- `artifacts/api-server/src/routes/` — Express route handlers
  - `analysis/options-flow.ts`, `news.ts`, `bills.ts`, `market-summary.ts`
  - `recommendations/analyze.ts` — SSE streaming endpoint (POST)
- `artifacts/market-intel/src/pages/home.tsx` — full 9-agent arena UI

## Architecture decisions

- 9-agent pipeline streams over SSE: flow analyst → news analyst → legislative → political → fact-check α → fact-check β → deliberation → risk manager → freshness validator
- Dual options-flow sources: Finnhub (live, keyed) merged with Yahoo Finance (no key), deduplicated by ticker, sorted by unusualScore
- Bills service cascades: Congress.gov (key) → OpenStates (key) → GovTrack (no key)
- News service cascades: NewsAPI (key) → RSS feeds (no key)
- All 9 agents use clod.io (OpenAI-compatible at `https://api.clod.io/v1`) — configurable model via `AI_MODEL` env var
- Loop mode: re-runs the full pipeline every 15 seconds with a countdown timer

## Product

- Set budget, risk level, and stop-loss parameters, optionally filter by sectors/tickers
- Hit "Deploy 9-Agent Pipeline" to fire all 9 AI agents in sequence
- Watch pixel-sprite agents animate live in a 3×3 arena grid as they work
- Debate log streams each agent's analysis in real-time
- Final screen: ranked options recommendations with composite scores, entry/target/stop prices, sizing, and key drivers
- Live Sources panel: 4 tabs showing raw options flow, news articles, legislative bills, and political statements used by the agents
- Loop mode: toggle ON to auto-rerun every 15 seconds for continuous monitoring

## Required Environment Secrets

- `CLOD_API_KEY` — clod.io API key for AI agents
- `FINNHUB_API_KEY` — live options flow
- `NEWS_API_KEY` — NewsAPI for market news
- `CONGRESS_API_KEY` — Congress.gov for federal legislation
- `OPENSTATES_API_KEY` — OpenStates for state-level bills
- `SESSION_SECRET` — session secret

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- API server rebuilds on every `pnpm run dev` restart (esbuild, ~140ms) — no hot reload
- GDELT political statements endpoint occasionally returns 0 results if no matching articles indexed recently
- Options flow scores: Finnhub raw scores can be high (50–110); Yahoo synthetic scores cap at ~30
- `zod` must be in `dependencies` (not devDependencies) in `api-server/package.json` — esbuild bundles it at runtime
- Routes must use `.js` extension in ESM imports (e.g., `import ... from "./health.js"`)

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
