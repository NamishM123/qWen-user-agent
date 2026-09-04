import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

let loaded = false;

/** Load parent repo .env into process.env (does not override existing). */
export function loadRootEnv() {
  if (loaded) return;
  loaded = true;
  const candidates = [
    resolve(process.cwd(), "..", ".env"),
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), ".env"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const raw of readFileSync(p, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (val.length >= 2) {
        const a = val[0];
        const b = val[val.length - 1];
        if ((a === "\"" && b === "\"") || (a === "'" && b === "'")) {
          val = val.slice(1, -1);
        }
      }
      if (process.env[key] == null || process.env[key] === "") {
        process.env[key] = val;
      }
    }
  }
  if (!process.env.AUTH_SECRET) {
    process.env.AUTH_SECRET = "dev-insecure-change-me";
  }
  if (!process.env.AUTH_DEV_USER) {
    process.env.AUTH_DEV_USER = "dev@local";
  }
}
