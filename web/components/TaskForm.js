"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function TaskForm() {
  const router = useRouter();
  const [url, setUrl] = useState("https://example.com");
  const [task, setTask] = useState(
    "Click the Learn more / More information link and stop when you leave example.com.",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, task }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || res.statusText);
      if (res.status === 401) router.push("/login");
      return;
    }
    router.push(`/runs/${data.id}`);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-base font-semibold">Submit a task</h2>
      <label className="block text-sm">
        <span className="mb-1 block text-zinc-600 dark:text-zinc-300">URL</span>
        <input
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-zinc-600 dark:text-zinc-300">Prompt</span>
        <textarea
          className="min-h-[88px] w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          required
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {busy ? "Submitting…" : "Run agent"}
      </button>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </form>
  );
}
