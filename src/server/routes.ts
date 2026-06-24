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

import express, { type Express, type Request, type Response } from 'express';
import type { SessionStore, Session } from './sessions.js';
import { runAgentTurn, type AgentTurn } from '../agent/agent.js';
import type { LlmClient } from '../agent/llm.js';
import { executeTool } from '../agent/tools.js';
import { parseW2Pdf } from '../tax/w2pdf.js';
import { validateW2 } from '../tax/w2.js';
import { renderForm1040Pdf } from '../form/fill1040.js';

/** Max W-2 PDF upload size — generous for a scanned single page, bounded for safety. */
const MAX_PDF_BYTES = 8 * 1024 * 1024;

export function registerChatRoutes(app: Express, sessions: SessionStore, llm: LlmClient): void {
  app.post('/api/session', async (_req, res) => {
    const s = sessions.create();
    try {
      const greeting = await runAgentTurn(s, llm, null);
      res.json({ sessionId: s.id, ...projectTurn(greeting) });
    } catch (err) {
      res.status(502).json({ sessionId: s.id, error: llmError(err) });
    }
  });

  app.post('/api/session/:id/message', async (req: Request, res: Response) => {
    const s = sessions.get(req.params.id ?? '');
    if (!s) return res.status(404).json({ error: 'session not found' });

    const message = typeof req.body?.message === 'string' ? req.body.message : '';
    if (!message.trim()) return res.status(400).json({ error: 'empty message' });

    try {
      const turn = await runAgentTurn(s, llm, message);
      res.json(projectTurn(turn));
    } catch (err) {
      s.trace.record('guardrail', `turn failed: ${llmError(err)}`);
      res.status(502).json({ error: llmError(err) });
    }
  });

  // W-2 PDF upload (Pillar 2 tool: ingest a real file). The client POSTs the raw
  // PDF bytes with Content-Type application/pdf. We extract the W-2, run it
  // through the same acceptance path as a pasted/sample W-2, and return a turn.
  app.post(
    '/api/session/:id/upload',
    express.raw({ type: 'application/pdf', limit: MAX_PDF_BYTES }),
    async (req: Request, res: Response) => {
      const s = sessions.get(req.params.id ?? '');
      if (!s) return res.status(404).json({ error: 'session not found' });

      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        return res.status(400).json({ error: 'expected a non-empty application/pdf body' });
      }

      s.trace.record('user_message', `[uploaded a W-2 PDF, ${body.length} bytes]`);
      s.trace.record('tool_call', 'parseW2Pdf: extracting W-2 from uploaded PDF', { bytes: body.length });

      try {
        const w2 = await parseW2Pdf(new Uint8Array(body), s.trace);
        if (!w2) {
          // Hand the failure to the agent so it can respond warmly and recover.
          const turn = await runAgentTurn(
            s,
            llm,
            "(system: the user uploaded a W-2 PDF but it could not be read — no W-2 extracted. Apologize briefly and offer to let them paste the figures or use the sample.)",
          );
          return res.json(projectTurn(turn));
        }
        // The W-2 arrived out-of-band: accept it through the validating tool
        // executor (a real tool action, recorded on the trace), then let the
        // agent acknowledge and ask the next question.
        const accepted = setUploadedW2(s, w2);
        const turn = await runAgentTurn(
          s,
          llm,
          `(system: the user just uploaded their W-2 PDF. ${accepted} Acknowledge it warmly and continue — do not ask for the W-2 again.)`,
        );
        res.json(projectTurn(turn));
      } catch (err) {
        s.trace.record('guardrail', `upload failed: ${llmError(err)}`);
        res.status(502).json({ error: llmError(err) });
      }
    },
  );

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

/** Shape the agent's turn for the wire. */
function projectTurn(turn: AgentTurn) {
  return {
    reply: turn.reply,
    done: turn.done,
    canDownload: turn.done,
  };
}

/**
 * Validate and store an uploaded W-2 on the session (the upload path's
 * equivalent of the use_sample_w2 / parse_w2_text tools). Returns a short
 * summary for the agent's context.
 */
function setUploadedW2(session: Session, w2: import('../domain/types.js').W2): string {
  const validation = validateW2(w2, session.trace);
  if (!validation.ok) {
    session.trace.record('guardrail', 'uploaded W-2 failed validation', { errors: validation.errors });
    return `The uploaded W-2 has a problem: ${validation.errors.join(' ')} Ask the user to correct it.`;
  }
  session.w2 = w2;
  session.trace.record('fact_captured', 'W-2 accepted (uploaded PDF)', {
    wages: w2.wages,
    employee: w2.employeeName,
  });
  return `W-2 accepted: ${w2.employeeName}, wages $${Math.round(w2.wages).toLocaleString('en-US')}, federal withholding $${Math.round(w2.federalIncomeTaxWithheld).toLocaleString('en-US')}.`;
}

function llmError(err: unknown): string {
  return err instanceof Error ? err.message : 'internal error';
}

// Augment Session with the computed form (set on completion).
declare module './sessions.js' {
  interface Session {
    form1040?: import('../domain/types.js').Form1040;
  }
}
