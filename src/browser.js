import { chromium } from 'playwright';

export async function launch({ headless = false } = {}) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  return { browser, context, page };
}

// Flatten the accessibility tree into a numbered list of interactable nodes.
// Each entry gets a stable index the model refers to when picking an action.
export async function snapshot(page) {
  const tree = await page.accessibility.snapshot({ interestingOnly: true });
  const nodes = [];
  const walk = (n) => {
    if (!n) return;
    const role = n.role;
    const name = (n.name || '').trim();
    const interactable = ['button', 'link', 'textbox', 'combobox', 'checkbox', 'radio', 'menuitem', 'tab'];
    if (interactable.includes(role) && name) {
      nodes.push({ index: nodes.length, role, name, value: n.value ?? null });
    }
    (n.children || []).forEach(walk);
  };
  walk(tree);
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
