import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PERSONAS_DIR = join(ROOT, 'personas');
export const JOBS_DIR = join(ROOT, 'jobs');
export const COMPARES_DIR = join(ROOT, 'compares');

export async function loadPersona(idOrPath) {
  const candidates = [
    idOrPath,
    join(PERSONAS_DIR, idOrPath),
    join(PERSONAS_DIR, `${idOrPath}.json`),
  ];
  for (const p of candidates) {
    if (p && existsSync(p) && p.endsWith('.json')) {
      return JSON.parse(await readFile(p, 'utf8'));
    }
  }
  throw new Error(`Persona not found: ${idOrPath}`);
}

export async function loadJob(idOrPath) {
  const candidates = [
    idOrPath,
    join(JOBS_DIR, idOrPath),
    join(JOBS_DIR, `${idOrPath}.json`),
  ];
  for (const p of candidates) {
    if (p && existsSync(p) && p.endsWith('.json')) {
      return JSON.parse(await readFile(p, 'utf8'));
    }
  }
  throw new Error(`Job not found: ${idOrPath}`);
}

export async function loadCompareConfig(idOrPath) {
  const candidates = [
    idOrPath,
    join(COMPARES_DIR, idOrPath),
    join(COMPARES_DIR, `${idOrPath}.json`),
    join(process.cwd(), idOrPath),
  ];
  for (const p of candidates) {
    if (p && existsSync(p) && p.endsWith('.json')) {
      return { path: p, config: JSON.parse(await readFile(p, 'utf8')) };
    }
  }
  throw new Error(`Compare config not found: ${idOrPath}`);
}

export async function listPersonas() {
  const files = (await readdir(PERSONAS_DIR)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    out.push(JSON.parse(await readFile(join(PERSONAS_DIR, f), 'utf8')));
  }
  return out;
}

export async function listJobs() {
  const files = (await readdir(JOBS_DIR)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    out.push(JSON.parse(await readFile(join(JOBS_DIR, f), 'utf8')));
  }
  return out;
}

/** Compact brief injected into the task preamble. */
export function formatPersonaBrief(persona) {
  if (!persona) return '';
  const c = persona.constraints || {};
  return [
    `[PERSONA: ${persona.name} (${persona.id})]`,
    `Demographic: ${persona.demographic}`,
    `Goals: ${(persona.goals || []).join('; ')}`,
    `Pain points: ${(persona.pain_points || []).join('; ')}`,
    `Patience: ${persona.patience}; tech comfort: ${persona.tech_comfort}`,
    `Constraints: budget=${c.budget || 'n/a'}; time=${c.time || 'n/a'}; a11y=${c.accessibility || 'n/a'}`,
    `Act like this person: prefer actions that match their patience and goals. If the UI is confusing for them, still try once, then done/stuck with an honest reason.`,
  ].join('\n');
}

/** System-prompt addendum so the automation loop stays valid JSON but persona-aware. */
export function formatPersonaSystemAddendum(persona) {
  if (!persona) return '';
  return `
PERSONA MODE — you still return ONLY valid browser-action JSON.
You are role-playing how ${persona.name} (${persona.id}) would use the product:
- Patience: ${persona.patience}. Low patience → fewer exploratory clicks; prefer done/stuck sooner if the path is unclear.
- Tech comfort: ${persona.tech_comfort}. Match how carefully they read labels.
- Goals: ${(persona.goals || []).slice(0, 3).join('; ')}
- Pain points they notice: ${(persona.pain_points || []).slice(0, 3).join('; ')}
Still NEVER invent elements or URLs. Prefer the smallest action this persona would take next.
When emitting done/stuck, phrase reason in first person as this persona briefly would.`.trim();
}

export function augmentTaskWithPersona(task, persona) {
  if (!persona) return task;
  return `${formatPersonaBrief(persona)}\n\nJob for this persona:\n${task}`;
}
