import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensureQueue } from "@/lib/queue";
import { loadRootEnv } from "@/lib/load-env";

loadRootEnv();

function promptVersion() {
  return process.env.PROMPT_VERSION || "v1.1";
}

function rateLimitTasksPerHour() {
  const n = Number(process.env.RATE_LIMIT_TASKS_PER_HOUR);
  if (!Number.isFinite(n)) return 30;
  return n;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const m = await ensureQueue();
  const userId = session.user.id || session.user.email;
  const tasks = m.isPostgres()
    ? await m.listTasksAsync({ user_id: userId, limit: 50 })
    : m.listTasks({ user_id: userId, limit: 50 });
  return NextResponse.json({ tasks, userId });
}

export async function POST(req) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const url = String(body.url || "").trim();
  const task = String(body.task || "").trim();
  if (!url || !task) {
    return NextResponse.json({ error: "url and task required" }, { status: 400 });
  }
  const m = await ensureQueue();
  const userId = session.user.id || session.user.email;

  const limit = rateLimitTasksPerHour();
  if (limit > 0) {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const recent = m.isPostgres()
      ? await m.countRecentTasksAsync({ user_id: userId, sinceIso: since })
      : m.countRecentTasks({ user_id: userId, sinceIso: since });
    if (recent >= limit) {
      return NextResponse.json(
        {
          error: "rate_limit",
          message: `Per-user rate limit exceeded (${recent}/${limit} tasks in the last hour)`,
          limit,
          recent,
        },
        { status: 429 },
      );
    }
  }

  const expect = body.expect ?? null;
  const pv = body.prompt_version || promptVersion();
  const id = m.isPostgres()
    ? await m.enqueueAsync({ url, task, expect, user_id: userId, prompt_version: pv })
    : m.enqueue({ url, task, expect, user_id: userId, prompt_version: pv });
  return NextResponse.json({ id, url, task, status: "pending", prompt_version: pv }, { status: 201 });
}
