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
