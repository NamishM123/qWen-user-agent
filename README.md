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

## Gaps

- UI enqueue is fire-and-forget (spawn CLI); watch the session page or CLI logs.
- Local 7B Qwen may not finish heavy housing sites perfectly — pipeline + coherent report is the bar.
- Dockerfile remains a minimal sketch.
