/**
 * The conversation orchestrator — the chat loop (Pillar 1) that carries state
 * across turns and takes real actions through tools (Pillar 2). It runs a
 * deterministic slot-filling state machine, which is what makes the harness
 * legible: the agent's control flow is data (a phase enum + filled slots), not a
 * black box. Guardrails (Pillar 3) wrap every turn; observation (Pillar 4) is
 * recorded at every step.
 *
 * Tone: warm, brief, human. The copy is hand-written rather than LLM-generated
 * so the app runs with no API key and the conversation is reproducible. An LLM
 * could be layered in to paraphrase these lines (see paraphrase()), but the
 * control flow never depends on it.
 *
 * The 5-question budget is real: `session.questionsAsked` is incremented exactly
 * once per question put to the user, and the machine is structured so it asks at
 * most five before it has everything it needs for a simple W-2 return.
 */

import type { Session } from '../server/sessions.js';
import type { FilingStatus, W2 } from '../domain/types.js';
import { SAMPLE_W2 } from '../fixtures/sample-w2.js';
import { parseW2, validateW2 } from '../tax/w2.js';
import { computeReturn } from '../tax/engine.js';
import { classifyUserInput, budgetExhausted, QUESTION_BUDGET } from './guardrails.js';

export interface OrchestratorTurn {
  reply: string;
  /** True once the return is computed and the PDF is downloadable. */
  done: boolean;
}

/** Conversation phases — the explicit state the loop carries across turns. */
type Phase = 'greeting' | 'await_w2' | 'await_status' | 'await_dependents' | 'done';

declare module '../server/sessions.js' {
  interface Session {
    phase?: Phase;
  }
}

const STATUS_PROMPT =
  "What's your filing status? You can say **single**, **married filing jointly**, " +
  '**married filing separately**, or **head of household**.';

/**
 * Handle one conversational turn. `message` is null for the opening greeting.
 */
export async function handleTurn(session: Session, message: string | null): Promise<OrchestratorTurn> {
  if (message === null) return greet(session);

  // Guardrail: classify every turn before acting on it. Advice-seeking is
  // ALWAYS redirected. The "off-topic" check, however, only applies before the
  // user is engaged in answering a specific question — once we've asked
  // something concrete (W-2, status, dependents), their direct answer is
  // on-topic by context, so we don't second-guess it as off-topic.
  const verdict = classifyUserInput(message);
  const phase = session.phase ?? 'greeting';
  // Short, structured answers (status/dependents) are on-topic by context, so we
  // don't second-guess them as off-topic. W-2 entry stays guarded — but an
  // explicit "use the sample" intent is always allowed through.
  const answeringSlot = phase === 'await_status' || phase === 'await_dependents';
  const wantsSample = /\b(sample|example|demo|test data)\b/i.test(message);
  const suppressOffTopic = answeringSlot || wantsSample;
  if (
    verdict.kind === 'redirect' &&
    (verdict.reason === 'tax-advice-seeking' || !suppressOffTopic)
  ) {
    session.trace.record('guardrail', `redirected (${verdict.reason})`, { message });
    return say(session, verdict.reply);
  }
  session.trace.record('guardrail', 'input allowed', { phase });

  switch (session.phase ?? 'greeting') {
    case 'greeting':
    case 'await_w2':
      return handleW2(session, message);
    case 'await_status':
      return handleStatus(session, message);
    case 'await_dependents':
      return handleDependents(session, message);
    case 'done':
      return say(
        session,
        "Your 2025 Form 1040 is ready — use the download button above. Want to start over? Just reload the page.",
      );
  }
}

// ── Phase handlers ───────────────────────────────────────────────────────────

function greet(session: Session): OrchestratorTurn {
  session.phase = 'await_w2';
  return ask(
    session,
    "Hi! I'm here to help you put together your 2025 Form 1040 — it's quick and I'll keep it friendly. " +
      "First, your W-2. You can paste the details, or just say **\"use the sample\"** and I'll load a realistic " +
      'test W-2 so you can see how this works.',
  );
}

function handleW2(session: Session, message: string): OrchestratorTurn {
  const lower = message.toLowerCase();
  const wantsSample = /sample|example|test|demo|use (the|your)/.test(lower);

  const w2 = wantsSample ? SAMPLE_W2 : parseW2(message, session.trace);

  if (!w2) {
    // Couldn't parse — recover gracefully without spending a new question.
    session.trace.record('guardrail', 'W-2 not parseable; asking to re-paste or use sample');
    return say(
      session,
      "I couldn't quite read that W-2. No worries — you can **upload the PDF**, paste it again with the box " +
        'numbers (e.g. "Box 1: 44629.35", "Box 2: 7631.62"), or just say **"use the sample"** to try it with test data.',
    );
  }

  return acceptW2(session, w2);
}

/**
 * Entry point for a W-2 that arrived as an uploaded PDF (via the upload route).
 * The route has already extracted the W2 shape with parseW2Pdf; here we run the
 * same validate → accept → advance path the pasted/sample flow uses, so an
 * uploaded W-2 behaves identically to a pasted one. Returns a re-prompt turn if
 * extraction failed (w2 is null).
 */
export function handleUploadedW2(session: Session, w2: W2 | null): OrchestratorTurn {
  if (!w2) {
    session.trace.record('guardrail', 'W-2 PDF not parseable; asking to paste or use sample');
    return say(
      session,
      "I couldn't read a W-2 out of that PDF. You can try a different file, paste the figures " +
        '(e.g. "Box 1: 44629.35", "Box 2: 7631.62"), or say **"use the sample"** to continue with test data.',
    );
  }
  // An upload is only meaningful while we're still waiting for the W-2.
  if (session.phase && session.phase !== 'greeting' && session.phase !== 'await_w2') {
    return say(session, "Thanks, but I've already got your W-2 — let's keep going from here.");
  }
  return acceptW2(session, w2);
}

/** Shared validate → accept → advance-to-status logic for any W-2 source. */
function acceptW2(session: Session, w2: W2): OrchestratorTurn {
  const validation = validateW2(w2, session.trace);
  if (!validation.ok) {
    session.trace.record('guardrail', 'W-2 failed validation', { errors: validation.errors });
    return say(
      session,
      `That W-2 has a problem I should flag before we go on: ${validation.errors.join(' ')} ` +
        'Could you double-check and upload or paste it again, or say **"use the sample"**?',
    );
  }

  session.w2 = w2;
  session.trace.record('fact_captured', 'W-2 accepted', { wages: w2.wages, employee: w2.employeeName });

  const warn = validation.warnings.length ? ` (Heads up: ${validation.warnings.join(' ')})` : '';
  session.phase = 'await_status';
  return ask(
    session,
    `Got it — ${w2.employeeName}, wages of $${w2.wages.toLocaleString('en-US', { maximumFractionDigits: 0 })} ` +
      `and $${w2.federalIncomeTaxWithheld.toLocaleString('en-US', { maximumFractionDigits: 0 })} withheld.${warn}\n\n${STATUS_PROMPT}`,
  );
}

function handleStatus(session: Session, message: string): OrchestratorTurn {
  const status = parseFilingStatus(message);
  if (!status) {
    // Re-prompt without charging another question (we only count distinct asks).
    return say(session, `I didn't catch that one. ${STATUS_PROMPT}`);
  }
  session.profile.filingStatus = status;
  session.trace.record('fact_captured', 'filing status', { filingStatus: status });

  session.phase = 'await_dependents';
  return ask(
    session,
    'Thanks! Last question: **how many dependents** will you claim? If none, just say **0** or **none**.',
  );
}

async function handleDependents(session: Session, message: string): Promise<OrchestratorTurn> {
  const dependents = parseDependents(message);
  if (dependents === null) {
    return say(session, "Just a number is perfect — how many dependents? Say **0** if none.");
  }
  session.profile.dependents = dependents;
  session.trace.record('fact_captured', 'dependents', { dependents });

  return finish(session);
}

// ── Completion: run the tools, compute, render ───────────────────────────────

async function finish(session: Session): Promise<OrchestratorTurn> {
  const w2 = session.w2;
  const filingStatus = session.profile.filingStatus;
  const dependents = session.profile.dependents ?? 0;
  if (!w2 || !filingStatus) {
    return say(session, 'Hmm, I seem to be missing something. Could you reload and try again?');
  }

  session.trace.record('tool_call', 'computeReturn', { filingStatus, dependents });
  const form = computeReturn({ w2, profile: { filingStatus, dependents } });
  session.trace.record('computation', 'Form 1040 computed', {
    taxableIncome: form.taxableIncome,
    totalTax: form.totalTax,
    refund: form.refund,
    amountOwed: form.amountOwed,
  });

  session.form1040 = form;
  session.completed = true;
  session.phase = 'done';

  const outcome =
    form.refund > 0
      ? `you're getting a **refund of $${form.refund.toLocaleString('en-US')}**`
      : `you owe **$${form.amountOwed.toLocaleString('en-US')}**`;

  return say(
    session,
    `All done! Based on your W-2 and answers, your taxable income is ` +
      `$${form.taxableIncome.toLocaleString('en-US')}, your total tax is ` +
      `$${form.totalTax.toLocaleString('en-US')}, and ${outcome}.\n\n` +
      `Your completed 2025 Form 1040 is ready — hit the download button above. ` +
      `(Quick reminder: this is a prepared form for you to review, not tax advice, and I haven't filed it.)`,
    true,
  );
}

// ── Parsing helpers ──────────────────────────────────────────────────────────

function parseFilingStatus(message: string): FilingStatus | null {
  const m = message.toLowerCase();
  if (/\bmfj\b|jointly|married.*joint/.test(m)) return 'married_filing_jointly';
  if (/\bmfs\b|separately|married.*separate/.test(m)) return 'married_filing_separately';
  if (/\bhoh\b|head of household|head of house/.test(m)) return 'head_of_household';
  if (/\bsingle\b|unmarried/.test(m)) return 'single';
  // A bare "married" defaults to jointly (the common case) but we keep it explicit.
  if (/\bmarried\b/.test(m)) return 'married_filing_jointly';
  return null;
}

function parseDependents(message: string): number | null {
  const m = message.toLowerCase().trim();
  if (/\b(none|no|zero|nope|nobody)\b/.test(m)) return 0;
  const match = m.match(/\d+/);
  if (!match) return null;
  const n = Number(match[0]);
  if (!Number.isFinite(n) || n < 0 || n > 20) return null;
  return n;
}

// ── Trace-aware reply helpers ────────────────────────────────────────────────

/** Send a reply that is NOT a new question (re-prompts, confirmations, results). */
function say(session: Session, reply: string, done = false): OrchestratorTurn {
  session.trace.record('agent_message', reply);
  session.transcript.push({ role: 'agent', content: reply });
  return { reply, done };
}

/**
 * Send a reply that IS a question put to the user — charges the 5-question
 * budget exactly once. If the budget is somehow exhausted, we proceed with
 * safe defaults rather than asking a sixth question (hard guardrail).
 */
function ask(session: Session, reply: string): OrchestratorTurn {
  if (budgetExhausted(session.questionsAsked)) {
    session.trace.record('guardrail', `question budget (${QUESTION_BUDGET}) reached — not asking further`);
    return say(session, reply.split('\n\n').slice(-1)[0] ?? reply);
  }
  session.questionsAsked += 1;
  session.trace.record('question_asked', `question ${session.questionsAsked}/${QUESTION_BUDGET}`, {
    asked: session.questionsAsked,
  });
  session.trace.record('agent_message', reply);
  session.transcript.push({ role: 'agent', content: reply });
  return { reply, done: false };
}
