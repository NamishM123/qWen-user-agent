import { NextResponse } from "next/server";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { auth } from "@/lib/auth";
import { loadRootEnv } from "@/lib/load-env";

loadRootEnv();

function rootDir() {
  return process.env.QWEN_ROOT || join(process.cwd(), "..");
}

function personasDir() {
  return join(rootDir(), "personas");
}

export async function GET() {
  const dir = personasDir();
  let files = [];
  try { files = (await readdir(dir)).filter((f) => f.endsWith(".json")); } catch {
    return NextResponse.json({ personas: [], error: "personas dir missing" });
  }
  const personas = [];
  for (const f of files) {
    personas.push(JSON.parse(await readFile(join(dir, f), "utf8")));
  }
  return NextResponse.json({ personas });
}

// Turn a free-text name/id into a safe file stem: lowercase, hyphenated, [a-z0-9-] only.
function slugify(raw) {
  return String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Split a textarea into a trimmed, non-empty list (newlines or semicolons).
function toList(raw) {
  return String(raw || "")
    .split(/[\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12);
}

const LEVELS = new Set(["low", "med", "high"]);

export async function POST(req) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = slugify(body.id || body.name);
  const name = String(body.name || "").trim();
  const demographic = String(body.demographic || "").trim();

  if (!id) return NextResponse.json({ error: "name (or id) is required" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (!demographic) return NextResponse.json({ error: "demographic is required" }, { status: 400 });

  const patience = LEVELS.has(body.patience) ? body.patience : "med";
  const tech_comfort = LEVELS.has(body.tech_comfort) ? body.tech_comfort : "med";

  const persona = {
    id,
    name,
    demographic,
    goals: toList(body.goals),
    pain_points: toList(body.pain_points),
    patience,
    tech_comfort,
    constraints: {
      budget: String(body.budget || "").trim() || "n/a",
      time: String(body.time || "").trim() || "n/a",
      accessibility: String(body.accessibility || "").trim() || "n/a",
    },
    voice: String(body.voice || "").trim(),
  };

  const dir = personasDir();
  if (!existsSync(dir)) {
    return NextResponse.json({ error: "personas dir missing" }, { status: 500 });
  }
  const path = join(dir, `${id}.json`);
  if (existsSync(path)) {
    return NextResponse.json({ error: `persona "${id}" already exists` }, { status: 409 });
  }

  await writeFile(path, JSON.stringify(persona, null, 2) + "\n", "utf8");
  return NextResponse.json({ persona }, { status: 201 });
}
