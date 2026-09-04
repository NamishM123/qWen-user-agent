import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export const dynamic = "force-dynamic";

function candidates() {
  const cwd = process.cwd();
  return [
    join(cwd, "showcase", "manifest.json"),
    join(cwd, "..", "showcase", "manifest.json"),
    join(cwd, "public", "showcase", "manifest.json"),
  ];
}

export async function GET() {
  for (const p of candidates()) {
    if (!existsSync(p)) continue;
    try {
      const raw = JSON.parse(await readFile(p, "utf8"));
      return NextResponse.json(raw);
    } catch (err) {
      return NextResponse.json({ error: err.message, items: [] }, { status: 500 });
    }
  }
  return NextResponse.json({
    title: "Example runs",
    description: "Add showcase/manifest.json",
    items: [],
  });
}
