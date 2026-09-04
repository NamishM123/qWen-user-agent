"use client";

import { useEffect, useState } from "react";

export default function ShowcaseGallery() {
  const [items, setItems] = useState([]);
  const [title, setTitle] = useState("Example runs");
  const [desc, setDesc] = useState("");

  useEffect(() => {
    fetch("/api/showcase")
      .then((r) => r.json())
      .then((data) => {
        setItems(data.items || []);
        if (data.title) setTitle(data.title);
        if (data.description) setDesc(data.description);
      })
      .catch(() => {});
  }, []);

  if (!items.length) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-sm text-zinc-500 dark:border-zinc-700">
        Showcase gallery loading… or no examples yet.
      </div>
    );
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {desc ? <p className="text-sm text-zinc-500">{desc}</p> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((it) => (
          <article
            key={it.id}
            className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          >
            {it.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={it.image} alt={it.title} className="h-36 w-full object-cover bg-zinc-100 dark:bg-zinc-800" />
            ) : null}
            <div className="space-y-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{it.title}</h3>
                <span
                  className={
                    it.outcome === "success"
                      ? "text-xs font-medium text-emerald-600"
                      : "text-xs font-medium text-zinc-500"
                  }
                >
                  {it.outcome}
                </span>
              </div>
              <p className="truncate text-xs text-zinc-500">{it.url}</p>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">{it.task}</p>
              {it.logSnippet ? (
                <pre className="overflow-x-auto rounded-md bg-zinc-50 p-2 text-[11px] text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                  {it.logSnippet}
                </pre>
              ) : null}
              <p className="text-[11px] text-zinc-400">
                prompt {it.prompt_version || "?"} · {it.stepCount ?? "?"} steps
                {it.finalUrl ? ` · → ${it.finalUrl}` : ""}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
