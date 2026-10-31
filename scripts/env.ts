// scripts/env.ts
// Loads .env.local (git-ignored) for command-line scripts; Next.js does this itself for the app.
import { existsSync } from "node:fs";

for (const f of [".env.local", ".env"]) if (existsSync(f)) process.loadEnvFile(f);

export function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set. Copy .env.example to .env.local and fill it in.`);
  return v;
}
