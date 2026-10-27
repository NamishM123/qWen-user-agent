# qWen User Agent

**Persona-based competitive UX research** — not primarily task automation.

Pick a demographic persona, run the same short jobs on App A vs similar B/C in a real browser (local Qwen), then get evidence-backed feedback and feature suggestions in that persona voice. The browser agent loop is the foundation.

## Demo in 5 minutes

1. Install deps, copy .env.example to .env (local Ollama + qwen2.5:7b).
2. Smoke (headless): use the compare script with compares/demo-smoke.json
3. Housing demo: use the compare script with compares/demo-housing.json
4. Regenerate a report: use the feedback script with <sessionId>
5. Optional UI: start worker + web, open localhost:3000, sign in, use Persona compare.

Artifacts: runs/compare/<sessionId>/ (session.json, per-app/job dirs, report.md, report.json).

## Product idea

- personas/ — who uses the product (patience, goals, voice)
- jobs/ — reusable natural-language flows
- compares/ — App A/B/C URLs + shared job ids
- src/compare.js — persona x app x job via existing run()
- src/feedback.js — LLM report from logs only (no invented UI)

## Phase 0-4 still work

Concurrency, guardrails, prompt A/B, showcase, queue worker, eval — unchanged. Phase 5 builds on top.

## Scripts

- compare / feedback — persona research pipeline
- worker / worker:pool / web / eval / prompts:compare / start

## Layout

- personas/, jobs/, compares/
- src/agent.js, compare.js, feedback.js, persona.js, qwen.js
- web/ — research dashboard + compare session viewer
- runs/compare/ — session outputs

## Running in a cloud / CI container

The pipeline is designed to run against a **local** Qwen (Ollama) and to drive a
real browser with outbound internet. A sandboxed CI/cloud container usually has
neither, so expect these constraints:

- **Browser**: `playwright install` is often blocked. Point Playwright at a
  pre-installed Chromium with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (see
  `.env.example`) instead of downloading one. `src/browser.js` honors it and is
  unset by default, so local dev is unchanged.
- **Web deps**: `web/.npmrc` sets `legacy-peer-deps=true` so `next@16` installs
  alongside `next-auth@5-beta` (whose peer range is conservative). `npm --prefix
  web install` then succeeds.
- **LLM**: there's no local Ollama in most containers. Set `LLM_BASE_URL` /
  `LLM_API_KEY` / `LLM_MODEL` to a hosted OpenAI-compatible endpoint
  (e.g. OpenRouter, see `.env.example`) to run the agent end-to-end there.
- **Outbound browsing**: if the sandbox blocks egress, `page.goto` fails with
  `net::ERR_TUNNEL_CONNECTION_FAILED` and the task is marked `failed` with that
  error — the queue, worker, SSE, and web UI still work; only the live browse
  step needs network.

What works with no LLM and no egress: `npm install`, `npm --prefix web install`,
`next build`, the SQLite queue, the worker loop (claims tasks, launches the
headless browser), web auth (dev login), the task/compare APIs, and the SSE
stream.

## Gaps

- UI enqueue is fire-and-forget (spawn CLI); watch the session page or CLI logs.
- Local 7B Qwen may not finish heavy housing sites perfectly — pipeline + coherent report is the bar.
- Dockerfile remains a minimal sketch.
