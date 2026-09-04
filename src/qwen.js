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

Return a SINGLE JSON object, no prose, matching one of these shapes:
{"type":"click","role":"button","name":"Sign up"}
{"type":"type","role":"textbox","name":"Email","text":"user@example.com"}
{"type":"navigate","url":"https://..."}
{"type":"wait","ms":1000}
{"type":"done","reason":"task complete: reached dashboard"}
{"type":"stuck","reason":"no viable next action"}

Rules:
- "role" and "name" must match an element from the list exactly.
- Prefer the smallest action that makes progress.
- If the same action has failed twice, try a different element or emit "stuck".
- Emit "done" as soon as the task is satisfied.`;

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
