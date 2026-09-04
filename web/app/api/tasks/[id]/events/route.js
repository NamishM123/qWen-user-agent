import { auth } from "@/lib/auth";
import { ensureQueue } from "@/lib/queue";
import { loadRootEnv } from "@/lib/load-env";

loadRootEnv();

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req, { params }) {
  const session = await auth();
  if (!session?.user) {
    return new Response("unauthorized", { status: 401 });
  }
  const id = Number((await params).id);
  if (!id) return new Response("bad id", { status: 400 });

  const m = await ensureQueue();
  const task = m.isPostgres() ? await m.getTaskAsync(id) : m.getTask(id);
  if (!task) return new Response("not found", { status: 404 });
  const userId = session.user.id || session.user.email;
  if (task.user_id && task.user_id !== userId) {
    return new Response("forbidden", { status: 403 });
  }

  const url = new URL(req.url);
  let afterId = Number(url.searchParams.get("after") || 0);

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      send({ type: "hello", taskId: id, status: task.status });

      const tick = async () => {
        if (closed) return;
        try {
          const events = m.isPostgres()
            ? await m.listEventsAsync(id, { afterId, limit: 100 })
            : m.listEvents(id, { afterId, limit: 100 });
          for (const ev of events) {
            afterId = ev.id;
            send({ type: "event", id: ev.id, eventType: ev.type, ts: ev.ts, payload: ev.payload });
          }
          const latest = m.isPostgres() ? await m.getTaskAsync(id) : m.getTask(id);
          if (latest && (latest.status === "done" || latest.status === "failed")) {
            send({ type: "status", status: latest.status, task: latest });
            // one more event drain then close
            const more = m.isPostgres()
              ? await m.listEventsAsync(id, { afterId, limit: 100 })
              : m.listEvents(id, { afterId, limit: 100 });
            for (const ev of more) {
              afterId = ev.id;
              send({ type: "event", id: ev.id, eventType: ev.type, ts: ev.ts, payload: ev.payload });
            }
            send({ type: "close", status: latest.status });
            closed = true;
            controller.close();
            return;
          }
        } catch (err) {
          send({ type: "error", message: err.message || String(err) });
        }
        if (!closed) setTimeout(tick, 800);
      };
      tick();
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
