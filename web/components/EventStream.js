"use client";

import { useEffect, useRef, useState } from "react";

export default function EventStream({ taskId }) {
  const [events, setEvents] = useState([]);
  const [status, setStatus] = useState("connecting");
  const [task, setTask] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    const es = new EventSource(`/api/tasks/${taskId}/events`);
    es.onmessage = (msg) => {
      let data;
      try {
        data = JSON.parse(msg.data);
      } catch {
        return;
      }
      if (data.type === "hello") {
        setStatus(data.status || "live");
      } else if (data.type === "event") {
        setEvents((prev) => [...prev, data]);
        setStatus("live");
      } else if (data.type === "status" || data.type === "close") {
        setStatus(data.status || "done");
        if (data.task) setTask(data.task);
        if (data.type === "close") es.close();
      } else if (data.type === "error") {
        setEvents((prev) => [...prev, { eventType: "error", payload: data }]);
      }
    };
    es.onerror = () => {
      setStatus((s) => (s === "done" || s === "failed" ? s : "reconnecting"));
    };
    return () => es.close();
  }, [taskId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span>
          Stream: <span className="font-medium">{status}</span>
        </span>
        {task?.run_dir ? (
          <span className="truncate text-xs text-zinc-500">run: {task.run_dir}</span>
        ) : null}
      </div>
      <div className="max-h-[480px] overflow-auto rounded-xl border border-zinc-200 bg-zinc-950 p-3 font-mono text-xs text-zinc-100 dark:border-zinc-800">
        {!events.length ? (
          <div className="text-zinc-500">Waiting for worker events…</div>
        ) : (
          events.map((ev) => {
            const p = ev.payload || {};
            const label = ev.eventType || p.type || "event";
            let detail = "";
            if (p.action) detail = JSON.stringify(p.action);
            else if (p.message) detail = p.message;
            else if (p.terminalReason) detail = p.terminalReason;
            else if (p.status) detail = p.status;
            else if (p.url) detail = p.url;
            else detail = JSON.stringify(p).slice(0, 200);
            return (
              <div key={ev.id || `${label}-${ev.ts}`} className="border-b border-zinc-800 py-1">
                <span className="text-emerald-400">{label}</span>
                {p.step != null ? <span className="text-amber-300"> step={p.step}</span> : null}
                <span className="text-zinc-400"> {detail}</span>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
