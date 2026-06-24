/**
 * In-memory session store. State-across-turns (Pillar 1) lives here: each
 * session carries the conversation transcript, the slots gathered so far, and
 * its observation Trace. In-memory is the right call for a single-instance
 * prototype — no external store, no PII at rest, sessions evaporate on restart.
 */

import { randomUUID } from 'node:crypto';
import { Trace } from '../observe/trace.js';
import type { W2, TaxpayerProfile } from '../domain/types.js';

export interface Session {
  id: string;
  createdAt: string;
  trace: Trace;
  /** The W-2 once provided/parsed. */
  w2?: W2;
  /** Slots filled by the conversation so far. */
  profile: Partial<TaxpayerProfile>;
  /** Full chat transcript for context across turns. */
  transcript: Array<{ role: 'user' | 'agent'; content: string }>;
  /** How many of the 5 budgeted questions have been asked. */
  questionsAsked: number;
  /** Set once the return is computed and the PDF is ready. */
  completed: boolean;
}

export interface SessionStore {
  create(): Session;
  get(id: string): Session | undefined;
}

export function createSessionStore(): SessionStore {
  const sessions = new Map<string, Session>();
  return {
    create() {
      const s: Session = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        trace: new Trace(),
        profile: {},
        transcript: [],
        questionsAsked: 0,
        completed: false,
      };
      s.trace.record('session_start', 'New filing session started', { sessionId: s.id });
      sessions.set(s.id, s);
      return s;
    },
    get(id) {
      return sessions.get(id);
    },
  };
}
