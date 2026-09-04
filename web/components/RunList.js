"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function RunList() {
  const router = useRouter();
  const [tasks, setTasks] = useState([]);
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/tasks");
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || res.statusText);
      return;
    }
    setTasks(data.tasks || []);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">History</h2>
        <button type="button" onClick={load} className="text-xs text-zinc-500 hover:underline">
          Refresh
        </button>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {!tasks.length ? (
        <p className="text-sm text-zinc-500">No runs yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {tasks.map((t) => (
            <li key={t.id} className="py-2">
              <a href={`/runs/${t.id}`} className="block hover:bg-zinc-50 dark:hover:bg-zinc-800/50 rounded-md px-2 py-1">
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium">#{t.id}</span>
                  <span
                    className={
                      t.status === "done"
                        ? "text-emerald-600"
                        : t.status === "failed"
                          ? "text-red-600"
                          : t.status === "running"
                            ? "text-amber-600"
                            : "text-zinc-500"
                    }
                  >
                    {t.status}
                  </span>
                </div>
                <div className="truncate text-xs text-zinc-500">{t.url}</div>
                <div className="truncate text-sm">{t.task}</div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
