import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { auth } from "@/lib/auth";
import { loadRootEnv } from "@/lib/load-env";

loadRootEnv();

function rootDir() {
  return process.env.QWEN_ROOT || join(process.cwd(), "..");
}

export async function GET(_req, ctx) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const params = await ctx.params;
  const sessionId = params.sessionId;
  const root = join(rootDir(), "runs", "compare", sessionId);
  const sessionPath = join(root, "session.json");
  if (!existsSync(sessionPath)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const data = JSON.parse(await readFile(sessionPath, "utf8"));
  let report_md = null;
  let report_json = null;
  if (existsSync(join(root, "report.md"))) report_md = await readFile(join(root, "report.md"), "utf8");
  if (existsSync(join(root, "report.json"))) report_json = JSON.parse(await readFile(join(root, "report.json"), "utf8"));
  return NextResponse.json({ session: data, report_md, report_json, root });
}
