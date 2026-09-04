"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("dev@local");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onDevLogin(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await signIn("dev", { email, redirect: false, callbackUrl: "/" });
    setBusy(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    router.push("/");
    router.refresh();
  }

  async function onGitHub() {
    setBusy(true);
    await signIn("github", { callbackUrl: "/" });
  }

  return (
    <div className="mx-auto max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Dev auth works without GitHub secrets. Set AUTH_GITHUB_ID / AUTH_GITHUB_SECRET for real OAuth.
      </p>

      <form onSubmit={onDevLogin} className="mt-6 space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block text-zinc-600 dark:text-zinc-300">Dev email</span>
          <input
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {busy ? "Signing in…" : "Continue with Dev Auth"}
        </button>
      </form>

      <div className="my-4 flex items-center gap-2 text-xs text-zinc-400">
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
        or
        <div className="h-px flex-1 bg-zinc-200 dark:bg-zinc-700" />
      </div>

      <button
        type="button"
        onClick={onGitHub}
        disabled={busy}
        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        Continue with GitHub
      </button>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
