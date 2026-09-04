import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { ensureQueue } from "@/lib/queue";
import { loadRootEnv } from "@/lib/load-env";

loadRootEnv();

export async function GET(_req, { params }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number((await params).id);
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const m = await ensureQueue();
  const task = m.isPostgres() ? await m.getTaskAsync(id) : m.getTask(id);
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });
  const userId = session.user.id || session.user.email;
  if (task.user_id && task.user_id !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json({ task });
}
