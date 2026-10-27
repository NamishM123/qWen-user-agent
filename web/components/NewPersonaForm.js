"use client";

import { useState } from "react";

const EMPTY = {
  name: "",
  demographic: "",
  goals: "",
  pain_points: "",
  patience: "med",
  tech_comfort: "med",
  budget: "",
  time: "",
  accessibility: "",
  voice: "",
};

export default function NewPersonaForm({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  function set(key, val) {
    setF((prev) => ({ ...prev, [key]: val }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setOk("");
    const res = await fetch("/api/personas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(f),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(data.error || res.statusText);
      return;
    }
    setOk(`Created "${data.persona.name}" (${data.persona.id})`);
    setF(EMPTY);
    if (onCreated) onCreated(data.persona);
  }

  const field =
    "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";
  const labelText = "mb-1 block text-zinc-600 dark:text-zinc-300";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
        aria-expanded={open}
      >
        <span className="text-base font-semibold">Create a persona</span>
        <span className="text-sm text-zinc-500">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className={labelText}>Name</span>
              <input className={field} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Jordan Reyes" required />
            </label>
            <label className="block text-sm">
              <span className={labelText}>Demographic</span>
              <input className={field} value={f.demographic} onChange={(e) => set("demographic", e.target.value)} placeholder="38-year-old parent of two…" required />
            </label>
          </div>

          <label className="block text-sm">
            <span className={labelText}>Goals <span className="text-zinc-400">(one per line)</span></span>
            <textarea className={`${field} min-h-[72px]`} value={f.goals} onChange={(e) => set("goals", e.target.value)} placeholder={"Complete core tasks with minimal back-and-forth\nTrust info before committing"} />
          </label>

          <label className="block text-sm">
            <span className={labelText}>Pain points <span className="text-zinc-400">(one per line)</span></span>
            <textarea className={`${field} min-h-[72px]`} value={f.pain_points} onChange={(e) => set("pain_points", e.target.value)} placeholder={"Long multi-step flows with no progress\nAmbiguous CTAs"} />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className={labelText}>Patience</span>
              <select className={field} value={f.patience} onChange={(e) => set("patience", e.target.value)}>
                <option value="low">low</option>
                <option value="med">med</option>
                <option value="high">high</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className={labelText}>Tech comfort</span>
              <select className={field} value={f.tech_comfort} onChange={(e) => set("tech_comfort", e.target.value)}>
                <option value="low">low</option>
                <option value="med">med</option>
                <option value="high">high</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm">
              <span className={labelText}>Budget</span>
              <input className={field} value={f.budget} onChange={(e) => set("budget", e.target.value)} placeholder="mid-range" />
            </label>
            <label className="block text-sm">
              <span className={labelText}>Time</span>
              <input className={field} value={f.time} onChange={(e) => set("time", e.target.value)} placeholder="evenings; interrupted" />
            </label>
            <label className="block text-sm">
              <span className={labelText}>Accessibility</span>
              <input className={field} value={f.accessibility} onChange={(e) => set("accessibility", e.target.value)} placeholder="readable text; one-handed" />
            </label>
          </div>

          <label className="block text-sm">
            <span className={labelText}>Voice <span className="text-zinc-400">(how the report should sound)</span></span>
            <textarea className={`${field} min-h-[60px]`} value={f.voice} onChange={(e) => set("voice", e.target.value)} placeholder="Practical and warm. Short sentences. Notices wasted time." />
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}
          {ok && <p className="text-sm text-emerald-600">{ok}</p>}

          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save persona"}
          </button>
        </form>
      )}
    </div>
  );
}
