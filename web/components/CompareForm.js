"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function CompareForm() {
  const router = useRouter();
  const [personas, setPersonas] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [personaId, setPersonaId] = useState("first-job-renter");
  const [urls, setUrls] = useState("https://example.com\nhttps://info.cern.ch\nhttps://example.org");
  const [selectedJobs, setSelectedJobs] = useState(["land-homepage"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessions, setSessions] = useState([]);

  async function loadMeta() {
    const [p, j, s] = await Promise.all([
      fetch("/api/personas").then((r) => r.json()).catch(() => ({ personas: [] })),
      fetch("/api/jobs").then((r) => r.json()).catch(() => ({ jobs: [] })),
      fetch("/api/compare").then((r) => r.json()).catch(() => ({ sessions: [] })),
    ]);
    setPersonas(p.personas || []);
    setJobs(j.jobs || []);
    setSessions(s.sessions || []);
    if ((p.personas || [])[0] && !p.personas.find((x) => x.id === personaId)) {
      setPersonaId(p.personas[0].id);
    }
  }

  useEffect(() => { loadMeta(); const t = setInterval(loadMeta, 5000); return () => clearInterval(t); }, []);

  function toggleJob(id) {
    setSelectedJobs((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const appUrls = urls.split(/\n+/).map((u) => u.trim()).filter(Boolean);
    const res = await fetch("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona: personaId, urls: appUrls, jobs: selectedJobs }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || res.statusText);
      if (res.status === 401) router.push("/login");
      return;
    }
    router.push("/compare/" + data.sessionId);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div>
          <h2 className="text-base font-semibold">Persona compare</h2>
          <p className="text-xs text-zinc-500">Run the same jobs as a demographic user across 2-3 apps, then get evidence-backed feedback.</p>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-zinc-600 dark:text-zinc-300">Persona</span>
          <select className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950" value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {p.id}</option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-zinc-600 dark:text-zinc-300">App URLs (one per line, App A first)</span>
          <textarea className="min-h-[88px] w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950" value={urls} onChange={(e) => setUrls(e.target.value)} required />
        </label>
        <fieldset className="text-sm">
          <legend className="mb-1 text-zinc-600 dark:text-zinc-300">Jobs</legend>
          <div className="flex flex-wrap gap-2">
            {jobs.map((j) => (
              <label key={j.id} className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1 dark:border-zinc-700">
                <input type="checkbox" checked={selectedJobs.includes(j.id)} onChange={() => toggleJob(j.id)} />
                <span>{j.id}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button type="submit" disabled={busy || selectedJobs.length === 0} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50">
          {busy ? "Starting…" : "Start compare"}
        </button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </form>
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="mb-2 text-sm font-semibold">Recent compare sessions</h3>
        {!sessions.length ? (
          <p className="text-sm text-zinc-500">None yet — use the CLI compare script.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {sessions.map((s) => (
              <li key={s.session_id} className="py-2">
                <a className="hover:underline" href={"/compare/" + s.session_id}>
                  <span className="font-medium">{s.session_id}</span>
                  <span className="ml-2 text-xs text-zinc-500">{s.status} · {s.persona_id}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
