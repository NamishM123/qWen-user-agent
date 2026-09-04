# qWen User Agent

Phase 4: concurrency, guardrails, prompt A/B, showcase.

## Demo in 5 minutes

Install deps, copy env, start a concurrent worker and the web UI, then open localhost:3000.
Logged-out visitors see the showcase gallery; Dev Auth unlocks task submission.
Use prompts:compare to group past runs by prompt_version.
Set a low RATE_LIMIT_TASKS_PER_HOUR to verify HTTP 429 on enqueue.

## Features

- Concurrent workers via WORKER_CONCURRENCY and atomic queue claims
- Guardrails: MAX_STEPS, latency/token/cost budgets, per-user rate limits
- Prompt version tags on tasks and final.json; prompts/v1.txt and v2.txt
- Public showcase from showcase/manifest.json
- docker-compose.yml for optional local multi-service

## Gaps

- No hosted fleet deploy required for this phase
- Dockerfile is a minimal sketch
- Showcase stills are sanitized examples

## Quick start steps

1. Install root and web packages
2. Copy .env.example to .env
3. Start worker with WORKER_CONCURRENCY=2
4. Start the web UI
5. Open http://localhost:3000 (showcase is public)
6. Run prompts:compare for A/B stats

## Scripts

- worker / worker:pool
- web / web:install
- eval
- prompts:compare
- start / runner / enqueue / process

## Env (Phase 4)

- WORKER_CONCURRENCY
- MAX_STEPS, MAX_LATENCY_MS, MAX_TOKENS_PER_TASK, MAX_COST_USD, COST_PER_1K_TOKENS
- RATE_LIMIT_TASKS_PER_HOUR
- PROMPT_VERSION (loads prompts/v1.txt or prompts/v2.txt)

## Layout

- src/agent.js, queue.js, worker.js, qwen.js, guardrails.js, prompts-compare.js
- prompts/, showcase/, web/, docker-compose.yml, Dockerfile
