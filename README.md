# qwen-user-agent

Phase 0: prove the loop closes. A single Node script that drives a real Chromium browser via Playwright, asks Qwen what to do next, executes the action, and repeats until the task is done or the agent is stuck.

## What's here

- `src/browser.js` — Playwright launch, accessibility-tree snapshot, action executor (click / type / navigate / wait).
- `src/qwen.js` — OpenAI SDK pointed at Ollama's OpenAI-compatible endpoint. Returns a single JSON action per turn.
- `src/agent.js` — the loop. Snapshots the page, calls the model, executes, tracks history, exits on `done`, `stuck`, model error, or `MAX_STEPS`.

Screenshots are intentionally NOT sent yet — the accessibility tree is cheaper and enough for the small sites we're validating against. Vision comes back in Phase 1 when we hit a page the tree can't describe.

## One-time setup

1. Install Node 20+ and pnpm/npm.
2. Install Ollama and pull a Qwen model:
   ```sh
   curl -fsSL https://ollama.com/install.sh | sh
   ollama pull qwen2.5:7b          # text-only, fast, good default for phase 0
   # or, if you have 8GB+ VRAM and want vision later:
   # ollama pull qwen2.5vl:7b
   ```
   Ollama serves an OpenAI-compatible API on `http://localhost:11434/v1`.
3. Install project deps (this also downloads a Chromium build for Playwright):
   ```sh
   npm install
   ```
4. Copy the env template:
   ```sh
   cp .env.example .env
   ```
   Defaults point at local Ollama. To use OpenRouter's free tier instead, uncomment those lines.

## Run it

```sh
node --env-file=.env src/agent.js "https://example.com" "Find the 'More information' link and click it."
```

The browser opens headed so you can watch. Each step logs the URL, the elements the model saw, the action it chose, and any failures. The run ends on `done`, `stuck`, model error, or after 25 steps.

## Test targets for Phase 0

Pick 2–3 small, forgiving sites and verify the loop closes on all of them before touching Phase 1:

- `https://the-internet.herokuapp.com/login` — task: `Log in with tomsmith / SuperSecretPassword!`
- `https://demo.playwright.dev/todomvc` — task: `Add three todos: buy milk, walk the dog, write report.`
- `https://example.com` — task: `Click the 'More information...' link.`

If the loop doesn't reliably close on these, no downstream polish will save you. That's the failure signal to act on before building further.

## Known-shaky bits (expected in Phase 0)

- Qwen's JSON adherence is decent but not perfect. `src/qwen.js` strips code fences as a fallback; if you see more parse failures, add a retry with a stricter re-prompt.
- Accessibility names sometimes don't match Playwright's `getByRole` locator (whitespace, hidden ancestors). If a click fails repeatedly, fall back to a text-content locator.
- No screenshots yet. If a target site's tree is empty (heavy canvas / custom widgets), that's the Phase 1 trigger.
