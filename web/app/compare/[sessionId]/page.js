"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

export default function CompareSessionPage() {
  const params = useParams();
  const sessionId = params.sessionId;
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  async function load() {
    const res = await fetch("/api/compare/" + sessionId);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { setError(json.error || res.statusText); return; }
    setData(json);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [sessionId]);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-zinc-500">Loading session…</p>;
  const s = data.session || {};
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wider text-emerald-600">Compare session</p>
        <h1 className="text-2xl font-semibold tracking-tight">{sessionId}</h1>
        <p className="text-sm text-zinc-500">Status: {s.status} · Persona: {s.persona?.name || s.persona?.id}</p>
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-2 font-semibold">Runs</h2>
        <ul className="space-y-1">
          {(s.runs || []).map((r, i) => (
            <li key={i}>
              <span className="font-medium">{r.app_id}/{r.job_id}</span>{" "}
              <span className={r.success ? "text-emerald-600" : "text-red-600"}>{r.success ? "ok" : "fail"}</span>
              <span className="text-zinc-500"> · steps {r.stepCount ?? "?"} · {r.finalUrl || r.url}</span>
            </li>
          ))}
        </ul>
        {!(s.runs || []).length ? <p className="text-zinc-500">Waiting for runs…</p> : null}
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-2 font-semibold">Report</h2>
        {data.report_md ? (
          <pre className="whitespace-pre-wrap text-sm leading-relaxed">{data.report_md}</pre>
        ) : (
          <p className="text-sm text-zinc-500">Report not ready yet (generated after compare completes).</p>
        )}
      </div>
    </div>
  );
}
