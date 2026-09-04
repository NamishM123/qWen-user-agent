import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { auth } from "@/lib/auth";
import { loadRootEnv } from "@/lib/load-env";

loadRootEnv();

function rootDir() {
  return process.env.QWEN_ROOT || join(process.cwd(), "..");
}

function compareRoot() {
  return join(rootDir(), "runs", "compare");
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const root = compareRoot();
  let dirs = [];
  try { dirs = await readdir(root); } catch { return NextResponse.json({ sessions: [] }); }
  const sessions = [];
  for (const id of dirs.sort().reverse().slice(0, 30)) {
    try {
      const raw = JSON.parse(await readFile(join(root, id, "session.json"), "utf8"));
      sessions.push({
        session_id: raw.session_id || id,
        status: raw.status,
        persona_id: raw.persona?.id,
        created_at: raw.created_at,
        has_report: Boolean(raw.report?.path_md) || existsSync(join(root, id, "report.md")),
      });
    } catch {}
  }
  return NextResponse.json({ sessions });
}

export async function POST(req) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const persona = String(body.persona || "").trim();
  const urls = Array.isArray(body.urls) ? body.urls.map((u) => String(u).trim()).filter(Boolean) : [];
  const jobs = Array.isArray(body.jobs) ? body.jobs.map((j) => String(j).trim()).filter(Boolean) : [];
  if (!persona || urls.length < 2 || !jobs.length) {
    return NextResponse.json({ error: "persona, >=2 urls, and jobs required" }, { status: 400 });
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "T");
  const sessionId = "ui-" + persona + "-" + stamp + "-" + Math.random().toString(36).slice(2, 6);
  const apps = urls.map((url, i) => ({
    id: i === 0 ? "app-a" : i === 1 ? "app-b" : "app-c" + (i > 2 ? String(i) : ""),
    name: "App " + String.fromCharCode(65 + i),
    url,
  }));
  // fix app-c naming
  apps.forEach((a, i) => { a.id = ["app-a", "app-b", "app-c"][i] || ("app-" + (i + 1)); });
  const config = {
    id: sessionId,
    name: "UI compare",
    persona,
    maxSteps: Number(body.maxSteps) || 6,
    apps,
    jobs,
  };
  const root = rootDir();
  const cfgDir = join(root, "compares", "_ui");
  await mkdir(cfgDir, { recursive: true });
  const cfgPath = join(cfgDir, sessionId + ".json");
  await writeFile(cfgPath, JSON.stringify(config, null, 2), "utf8");

  const child = spawn(
    process.execPath,
    ["--env-file=.env", "src/compare.js", cfgPath, "--session", sessionId],
    { cwd: root, detached: true, stdio: "ignore", env: { ...process.env, HEADLESS: process.env.HEADLESS || "1" } },
  );
  child.unref();
  return NextResponse.json({ sessionId, configPath: cfgPath, status: "started" }, { status: 201 });
}

