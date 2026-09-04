import { signIn } from "@/lib/auth";
import { loadRootEnv } from "@/lib/load-env";
import { NextResponse } from "next/server";

loadRootEnv();

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const email = (body.email || process.env.AUTH_DEV_USER || "dev@local").trim();
  try {
    await signIn("dev", { email, redirect: false });
    return NextResponse.json({ ok: true, email });
  } catch (err) {
    // Auth.js may throw NEXT_REDIRECT; treat as success when redirecting.
    if (String(err?.message || err).includes("NEXT_REDIRECT") || err?.digest?.includes("NEXT_REDIRECT")) {
      return NextResponse.json({ ok: true, email });
    }
    return NextResponse.json({ ok: false, error: err.message || String(err) }, { status: 401 });
  }
}
