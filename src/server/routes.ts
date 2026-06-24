/**
 * Chat routes. These map 1:1 to user actions:
 *   POST /api/session            → start a session
 *   POST /api/session/:id/message → one conversational turn
 *   GET  /api/session/:id/trace   → the observation trail (Pillar 4)
 *   GET  /api/session/:id/form    → download the completed 1040 (Pillar 2 output)
 *
 * The route layer is deliberately thin: it validates inputs, delegates a turn to
 * the orchestrator, and records the I/O on the session Trace. All conversation
 * logic lives in the orchestrator module.
 */

import type { Express, Request, Response } from 'express';
import type { SessionStore, Session } from './sessions.js';
import { handleTurn, type OrchestratorTurn } from '../agent/orchestrator.js';
import { renderForm1040Pdf } from '../form/fill1040.js';

export function registerChatRoutes(app: Express, sessions: SessionStore): void {
  app.post('/api/session', async (_req, res) => {
    const s = sessions.create();
    const greeting = await handleTurn(s, null);
    res.json({ sessionId: s.id, ...projectTurn(greeting) });
  });

  app.post('/api/session/:id/message', async (req: Request, res: Response) => {
    const s = sessions.get(req.params.id ?? '');
    if (!s) return res.status(404).json({ error: 'session not found' });

    const message = typeof req.body?.message === 'string' ? req.body.message : '';
    if (!message.trim()) return res.status(400).json({ error: 'empty message' });

    s.trace.record('user_message', message);
    s.transcript.push({ role: 'user', content: message });

    try {
      const turn = await handleTurn(s, message);
      res.json(projectTurn(turn));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'internal error';
      s.trace.record('guardrail', `turn failed: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  app.get('/api/session/:id/trace', (req, res) => {
    const s = sessions.get(req.params.id ?? '');
    if (!s) return res.status(404).json({ error: 'session not found' });
    const sinceRaw = req.query.since;
    const since = typeof sinceRaw === 'string' ? Number(sinceRaw) : 0;
    res.json({ events: s.trace.since(Number.isFinite(since) ? since : 0) });
  });

  app.get('/api/session/:id/form', async (req, res) => {
    const s = sessions.get(req.params.id ?? '');
    if (!s) return res.status(404).json({ error: 'session not found' });
    if (!s.completed || !s.form1040) {
      return res.status(409).json({ error: 'return not ready yet' });
    }
    const pdf = await renderForm1040Pdf(s.form1040);
    s.trace.record('form_generated', 'Rendered 1040 PDF for download', {
      bytes: pdf.length,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="form-1040-2025.pdf"');
    res.send(Buffer.from(pdf));
  });
}

/** Shape the orchestrator's turn for the wire. */
function projectTurn(turn: OrchestratorTurn) {
  return {
    reply: turn.reply,
    done: turn.done,
    canDownload: turn.done,
  };
}

// Augment Session with the computed form (set by the orchestrator on completion).
declare module './sessions.js' {
  interface Session {
    form1040?: import('../domain/types.js').Form1040;
  }
}
