import { NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadRootEnv } from "@/lib/load-env";

loadRootEnv();

function rootDir() {
  return process.env.QWEN_ROOT || join(process.cwd(), "..");
}

export async function GET() {
  const dir = join(rootDir(), "personas");
  let files = [];
  try { files = (await readdir(dir)).filter((f) => f.endsWith(".json")); } catch {
    return NextResponse.json({ personas: [], error: "personas dir missing" });
  }
  const personas = [];
  for (const f of files) {
    personas.push(JSON.parse(await readFile(join(dir, f), "utf8")));
  }
  return NextResponse.json({ personas });
}
