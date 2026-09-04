import { chromium } from 'playwright';

export async function launch({ headless = false } = {}) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  return { browser, context, page };
}

// Flatten the accessibility tree into a numbered list of interactable nodes.
// Each entry gets a stable index the model refers to when picking an action.
// Uses CDP because page.accessibility.snapshot() was removed in recent Playwright.
const INTERACTABLE = new Set(['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'menuitem', 'tab']);

export async function snapshot(page) {
  const client = await page.context().newCDPSession(page);
  let axNodes;
  try {
    ({ nodes: axNodes } = await client.send('Accessibility.getFullAXTree'));
  } finally {
    await client.detach().catch(() => {});
  }

  const nodes = [];
  for (const n of axNodes) {
    const role = n.role?.value;
    const name = n.name?.value?.trim();
    if (!role || !name || !INTERACTABLE.has(role)) continue;
    nodes.push({ index: nodes.length, role, name, value: n.value?.value ?? null });
  }

  return {
    url: page.url(),
    title: await page.title().catch(() => ''),
    nodes,
  };
}

// Execute one action returned by the model. Actions are intentionally small.
export async function act(page, action) {
  const { type } = action;
  if (type === 'click') {
    await page.getByRole(action.role, { name: action.name }).first().click({ timeout: 5000 });
  } else if (type === 'type') {
    const target = page.getByRole(action.role, { name: action.name }).first();
    await target.fill(action.text ?? '', { timeout: 5000 });
    if (action.submit) await target.press('Enter');
  } else if (type === 'press') {
    if (action.role && action.name) {
      await page.getByRole(action.role, { name: action.name }).first().press(action.key, { timeout: 5000 });
    } else {
      await page.keyboard.press(action.key);
    }
  } else if (type === 'navigate') {
    await page.goto(action.url, { waitUntil: 'domcontentloaded' });
  } else if (type === 'wait') {
    await page.waitForTimeout(Math.min(action.ms ?? 1000, 5000));
  } else if (type === 'done' || type === 'stuck') {
    return { terminal: true, reason: action.reason ?? type };
  } else {
    throw new Error(`Unknown action type: ${type}`);
  }
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  return { terminal: false };
}
