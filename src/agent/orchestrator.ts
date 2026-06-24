/**
 * The conversation orchestrator — the chat loop (Pillar 1) that carries state
 * across turns and takes real actions through tools (Pillar 2: parse W-2,
 * compute return, fill 1040). It runs a deterministic slot-filling state machine
 * for control and bounding, and uses an LLM only to phrase questions and
 * confirmations warmly (Pillar 3 keeps the LLM on a short leash).
 *
 * The state machine, the 5-question flow, the tone, and the tool wiring are
 * delivered by the corellia fan-out. This stub returns a friendly placeholder so
 * the scaffold runs end-to-end before the build.
 */

import type { Session } from '../server/sessions.js';

export interface OrchestratorTurn {
  reply: string;
  /** True once the return is computed and the PDF is downloadable. */
  done: boolean;
}

/**
 * Handle one conversational turn. `message` is null for the opening greeting.
 * Records agent output on the session trace and may set session.completed +
 * session.form1040 when the return is finished.
 */
export async function handleTurn(
  session: Session,
  message: string | null,
): Promise<OrchestratorTurn> {
  const reply =
    message === null
      ? "Hi! I'm here to help you put together your 2025 Form 1040. (The assistant is still being built — pending the corellia fan-out.)"
      : "Thanks! The conversation engine isn't wired up yet — pending the corellia fan-out.";
  session.trace.record('agent_message', reply);
  session.transcript.push({ role: 'agent', content: reply });
  return { reply, done: false };
}
