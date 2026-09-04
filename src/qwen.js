import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL || 'http://localhost:11434/v1',
  apiKey: process.env.LLM_API_KEY || 'ollama',
});

const MODEL = process.env.LLM_MODEL || 'qwen2.5:7b';

const SYSTEM = `You are a browser-automation agent. On each turn you receive:
- the user's task
- the current page (url, title)
- a numbered list of interactable elements with role and accessible name
- a short history of recent actions

BEFORE picking an action, ask yourself: is the task already satisfied by the current page state? If YES, your ONLY valid action is "done". Do not take any further action just because a button exists — extra clicks after the goal is achieved (logout, back, cancel, etc.) are FAILURES.

Signals the task is satisfied include:
- The URL changed to a page that represents the goal (e.g. /secure, /dashboard, /home after a login task).
- A success message or the requested content is visible.
- For "add N items" tasks: N items are visible in the list.

Return a SINGLE JSON object, no prose, matching one of these shapes:
{"type":"click","role":"<role>","name":"<name>"}
{"type":"type","role":"textbox","name":"<name>","text":"<text>","submit":true}
{"type":"press","key":"Enter","role":"textbox","name":"<name>"}
{"type":"navigate","url":"https://..."}
{"type":"wait","ms":1000}
{"type":"done","reason":"<describe why the task is now satisfied, referencing the current URL or visible content>"}
{"type":"stuck","reason":"<why no action can make progress>"}

Rules:
- "role" and "name" MUST match an element from the Elements list exactly. NEVER invent an element that is not listed.
- Write the "reason" fresh for the ACTUAL current page. Do not reuse example phrasing.
- If a form has an input but no visible submit button, add "submit": true to your "type" action (or use "press" with key "Enter").
- Prefer the smallest action that makes progress.
- If the same action has failed twice, try a different element or emit "stuck".`;

export async function nextAction({ task, snapshot, history }) {
  const user = [
    `Task: ${task}`,
    `URL: ${snapshot.url}`,
    `Title: ${snapshot.title}`,
    'Elements:',
    ...snapshot.nodes.slice(0, 60).map(
      (n) => `  [${n.index}] role=${n.role} name=${JSON.stringify(n.name)}${n.value ? ` value=${JSON.stringify(n.value)}` : ''}`,
    ),
    '',
    'Recent actions:',
    ...history.slice(-6).map((h, i) => `  ${i + 1}. ${JSON.stringify(h)}`),
  ].join('\n');

  const res = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user },
    ],
  });

  const raw = res.choices[0]?.message?.content ?? '{}';
  try {
    return JSON.parse(raw);
  } catch {
    // Some Qwen builds wrap JSON in fences; strip and retry once.
    const stripped = raw.replace(/```(?:json)?/g, '').trim();
    return JSON.parse(stripped);
  }
}
