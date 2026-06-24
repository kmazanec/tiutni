/**
 * HTTP surface for the tax-filing assistant.
 *
 * The server owns: static hosting of the chat UI, session lifecycle, and the
 * routes the front end calls. The conversational brain (the orchestrator), the
 * tax engine, and the 1040 filler are separate modules wired in here. Keeping
 * the server thin makes the harness pillars legible: routes map 1:1 to user
 * actions, and every action records into the session Trace.
 */

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createSessionStore } from './sessions.js';
import { registerChatRoutes } from './routes.js';
import { llmFromEnv, type LlmClient } from '../agent/llm.js';
import { loadDotEnv } from '../env.js';

// Load .env for local dev before anything reads process.env (Render injects
// real env vars, which always take precedence).
loadDotEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', '..', 'public');

/**
 * Build the app. `llm` is injectable so tests can pass a stub client; when not
 * supplied it is built from the environment, which REQUIRES OPENROUTER_API_KEY
 * (the conversation is LLM-driven — no static fallback).
 */
export function createApp(llm: LlmClient = llmFromEnv()) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  const sessions = createSessionStore();

  app.get('/health', (_req, res) => res.json({ ok: true }));

  registerChatRoutes(app, sessions, llm);

  app.use(express.static(PUBLIC_DIR));

  return app;
}

// Only listen when run directly (not when imported by tests).
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT ?? 3000);
  try {
    const app = createApp();
    app.listen(port, () => {
      // eslint-disable-next-line no-console
      console.log(`tax-filing assistant listening on http://localhost:${port}`);
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`Startup failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
