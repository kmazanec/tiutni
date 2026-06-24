/**
 * Minimal .env loader — no dependency. Reads KEY=VALUE lines from a .env file in
 * the project root and sets them on process.env (without overriding variables
 * already present in the real environment, which always win). Render injects env
 * vars directly, so this only matters for local development.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export function loadDotEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/env.ts (dev) or dist/env.js (prod) → project root is one level up.
  const root = join(here, '..');
  const path = join(root, '.env');
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, 'utf-8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip surrounding quotes.
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
