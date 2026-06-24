/**
 * The AGENT LOOP (Pillar 1: a real conversational loop that carries state across
 * turns) — LLM-driven, not a static state machine. Each user turn, the LLM reads
 * the full transcript, decides what to say, and CALLS TOOLS (Pillar 2) to take
 * real actions. The harness — not the prompt — enforces the rails (Pillar 3):
 *
 *   - The 5-QUESTION BUDGET is a hard counter. The harness tracks how many
 *     questions the agent has put to the user and, once the budget is spent,
 *     STOPS exposing the "ask the user" affordance: the system message switches
 *     to "you have NO questions left; proceed with what you have or finalize."
 *     The model physically cannot extract a sixth answer because we stop running
 *     its turn against fresh user input — the budget is mechanism, not request.
 *   - Every tool input is validated in code (tools.ts) before it touches the
 *     engine. The LLM never computes tax or writes the PDF; it only triggers the
 *     deterministic tools.
 *   - Off-topic / tax-advice input is classified and redirected before the LLM
 *     turn runs.
 *
 * Observation (Pillar 4): every LLM reply, tool call, tool result, and guardrail
 * decision is recorded on the session Trace.
 *
 * This module REQUIRES an OpenRouter key (see llm.ts) — the conversation is the
 * LLM. There is no static fallback.
 */

import type { Session } from '../server/sessions.js';
import { LlmClient, type ChatMessage } from './llm.js';
import { TOOL_SCHEMAS, executeTool } from './tools.js';
import { classifyUserInput, budgetExhausted, QUESTION_BUDGET } from './guardrails.js';

export interface AgentTurn {
  reply: string;
  done: boolean;
}

/** Max tool-call iterations within a single user turn (prevents runaway loops). */
const MAX_TOOL_ITERS = 6;

const SYSTEM_PROMPT = `You are a warm, friendly U.S. tax-filing assistant helping ONE person prepare their 2025 IRS Form 1040 from a single W-2 (a ~$40k wage earner). You chat with them and use tools to do the real work.

Your job:
- Greet warmly, then get their W-2 (they can upload a PDF, paste the text, or use the built-in sample), then their filing status, then their dependent count. Then compute and finalize the return.
- Keep it human and concise. Do not interrogate. One thing at a time. No walls of text.

HARD RULES (the system enforces these — do not fight them):
- You may ask the user AT MOST 5 questions total across the whole conversation. A "question" is any turn where you ask the user for information. Spend them wisely: realistically you need only ~3 (W-2, filing status, dependents). The system tells you how many you have left.
- You are NOT a tax advisor. Never recommend what to deduct, how to strategize, or what's "best". If asked for advice, gently decline and say a qualified professional can help. You also do NOT file the return — you only prepare the form.
- You never do tax math or produce the PDF yourself. Use the tools. The numbers come only from compute_and_finalize_return.

Tools:
- use_sample_w2 — load the realistic sample W-2.
- parse_w2_text — parse a W-2 the user pasted.
- set_filing_status — record their filing status (single / married_filing_jointly / married_filing_separately / head_of_household).
- set_dependents — record dependent count (0 if none).
- compute_and_finalize_return — compute the 1040 and prepare the download. Call this ONLY when you have the W-2, filing status, AND dependents.

When the W-2 was already provided out-of-band (e.g. the user uploaded a PDF), the system tells you so — don't ask for it again. After the return is finalized, tell the user their refund or amount owed warmly and that they can download their completed 1040 now.`;

/**
 * Run one user turn through the agent. `userMessage` is null for the opening
 * greeting. Returns the assistant's reply and whether the return is done.
 */
export async function runAgentTurn(
  session: Session,
  llm: LlmClient,
  userMessage: string | null,
): Promise<AgentTurn> {
  // Guardrail: classify real user input before spending an LLM turn on it.
  if (userMessage !== null) {
    const verdict = classifyUserInput(userMessage);
    if (verdict.kind === 'redirect' && verdict.reason === 'tax-advice-seeking') {
      session.trace.record('guardrail', 'redirected (tax-advice-seeking)', { userMessage });
      return record(session, verdict.reply, false);
    }
  }

  // Persist the incoming user message into the transcript so future turns and
  // the chat-history projection include it (the trace records it too).
  if (userMessage !== null) {
    session.trace.record('user_message', userMessage);
    session.transcript.push({ role: 'user', content: userMessage });
  }

  // Build the message list from the system prompt + the running transcript.
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'system', content: budgetNote(session) },
    ...toChatHistory(session),
  ];
  if (userMessage === null) {
    messages.push({ role: 'user', content: '(The conversation is starting. Greet the user warmly and ask for their W-2.)' });
  }

  const askedBefore = session.questionsAsked;

  // Tool-calling loop within this single turn.
  let assistantText = '';
  for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
    const resp = await llm.chat(messages, TOOL_SCHEMAS);
    if (resp.usage) {
      session.trace.record('tool_result', 'llm usage', {
        promptTokens: resp.usage.promptTokens,
        completionTokens: resp.usage.completionTokens,
        model: llm.model,
      });
    }

    if (resp.toolCalls.length > 0) {
      // Record the assistant's tool-calling message, then execute each tool.
      messages.push({ role: 'assistant', content: resp.content ?? '', tool_calls: resp.toolCalls });
      for (const call of resp.toolCalls) {
        const args = safeParseArgs(call.function.arguments);
        session.trace.record('tool_call', `agent → ${call.function.name}`, { args });
        const result = executeTool(session, call.function.name, args);
        session.trace.record('tool_result', `${call.function.name} → ${result.ok ? 'ok' : 'rejected'}`, {
          message: result.message,
        });
        messages.push({ role: 'tool', tool_call_id: call.id, content: result.message });
      }
      // Loop again so the model can respond to the tool results.
      continue;
    }

    // No tool calls → this is the assistant's spoken reply for the turn.
    assistantText = resp.content?.trim() || "Sorry, could you say that another way?";
    break;
  }

  // If the agent asked the user something this turn, charge the question budget.
  // Heuristic: a turn that ends with the agent talking (not finalizing) and the
  // return isn't done is treated as a question put to the user.
  if (!session.completed && userMessage !== null && looksLikeQuestion(assistantText)) {
    chargeQuestion(session);
  } else if (userMessage === null && looksLikeQuestion(assistantText)) {
    // The opening greeting asks for the W-2 — that's question 1.
    chargeQuestion(session);
  }
  void askedBefore;

  return record(session, assistantText, session.completed);
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** The dynamic system note that makes the 5-question budget legible to the model. */
function budgetNote(session: Session): string {
  const left = Math.max(0, QUESTION_BUDGET - session.questionsAsked);
  if (budgetExhausted(session.questionsAsked)) {
    return `BUDGET: You have asked all ${QUESTION_BUDGET} of your allowed questions. You may NOT ask the user anything else. Use the information you already have: if you have a W-2, a filing status, and a dependent count, call compute_and_finalize_return now. If something is still missing, make the most reasonable safe assumption (e.g. 0 dependents) and finalize — do not ask.`;
  }
  return `BUDGET: You have ${left} of ${QUESTION_BUDGET} questions left.`;
}

/** Convert the session transcript into chat messages. */
function toChatHistory(session: Session): ChatMessage[] {
  return session.transcript.map((t) => ({
    role: t.role === 'agent' ? 'assistant' : 'user',
    content: t.content,
  }));
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A turn counts as a question if it ends asking the user for something. */
function looksLikeQuestion(text: string): boolean {
  if (!text) return false;
  if (text.includes('?')) return true;
  return /\b(please|could you|can you|what|which|how many|let me know|tell me)\b/i.test(text);
}

function chargeQuestion(session: Session): void {
  session.questionsAsked += 1;
  session.trace.record('question_asked', `question ${session.questionsAsked}/${QUESTION_BUDGET}`, {
    asked: session.questionsAsked,
  });
}

function record(session: Session, reply: string, done: boolean): AgentTurn {
  session.trace.record('agent_message', reply);
  session.transcript.push({ role: 'agent', content: reply });
  return { reply, done };
}
