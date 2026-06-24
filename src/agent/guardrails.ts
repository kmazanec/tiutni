/**
 * Guardrails (Pillar 3): the constraints that keep the agent on-task, safe, and
 * bounded. These are CODE-enforced, not prompt-suggested:
 *
 *   - the 5-question budget is a hard counter the orchestrator cannot exceed;
 *   - off-topic / advice-seeking input is classified and redirected;
 *   - every value the agent accepts is schema/range validated before use;
 *   - the agent never claims to give tax advice or to file the return.
 */

export const QUESTION_BUDGET = 5;

export type GuardrailVerdict =
  | { kind: 'allow' }
  | { kind: 'redirect'; reason: string; reply: string };

// ---------------------------------------------------------------------------
// Tax-advice-seeking patterns — phrases that signal the user is asking for
// judgement calls, strategy, or professional tax guidance. Each pattern
// includes enough tax-specific context to avoid matching generic non-tax
// messages (e.g. "what should I eat" won't match).
// ---------------------------------------------------------------------------
const ADVICE_PATTERNS: RegExp[] = [
  /should i (file|claim|deduct|itemize|contribute|report|declare|take|pay|withhold|convert|roll|sell|buy|hold|invest|save|elect|choose)/i,
  /what('s| is) the best (way|method|strategy|approach|deduction|credit|status|form|option)/i,
  /how (can|do) I (avoid|minimize|reduce|save).*\btax/i,
  /is (it|this|that) better/i,
  /tax advice/i,
  /loophole/i,
  /write[\s-]?off/i,
  /is (this|that|it) .*deductible/i,
  /can I (deduct|claim|write)/i,
  /what (would|should) you (recommend|suggest|advise)/i,
  /(give|offer|provide) (me )?(tax )?advice/i,
  /how (much|many) (should|can) I (claim|deduct|contribute|withhold|report)/i,
  /am I (eligible|entitled) (for|to)/i,
  /do I (qualify|have to) (file|pay|report|claim)/i,
];

// ---------------------------------------------------------------------------
// Keywords that suggest the user is still talking about tax filing. If none
// of these appear (and the input isn't a trivial confirmation), the message
// is treated as off-topic.
// ---------------------------------------------------------------------------
const TAX_KEYWORDS = [
  'tax', '1040', 'w-2', 'w2', 'filing', 'file', 'return', 'refund',
  'income', 'wages', 'dependent', 'married', 'single', 'filing status',
  'withholding', 'deduction', 'credit', 'irs', 'withheld', 'employer',
  'spouse', 'household', 'form', 'box', 'amount', 'salary', 'pay',
  'ira', '401k', '401(k)', 'hsa',
  // Filing-status abbreviations the orchestrator may offer as quick answers.
  'mfj', 'mfs', 'hoh', 'jointly', 'separately', 'head of household',
];

// Mapping of short confirmations / answers that are always on-topic.
const SHORT_ANSWERS = new Set([
  'yes', 'no', 'ok', 'okay', 'sure', 'nope', 'yep', 'yeah', 'nah',
  'maybe', 'idk', 'correct', 'right', 'wrong', 'thanks', 'thank you',
]);

// ---------------------------------------------------------------------------
// Redirect reply templates — warm, firm, and consistent.
// ---------------------------------------------------------------------------
const ADVICE_REDIRECT_REPLY =
  "I can help you fill out your 2025 Form 1040 with the numbers you provide, but I can't give tax advice. " +
  "I'm not able to tell you what to deduct, how to strategize, or what choices are best for your situation — " +
  "a qualified tax professional can help with those questions. I also don't file your return; I just help you " +
  "prepare the form. Would you like to continue with entering your W-2 information?";

const OFFTOPIC_REDIRECT_REPLY =
  "I'm here to help you prepare your 2025 Form 1040 — I can walk you through entering your W-2, confirming " +
  "your filing status and dependents, and computing your return. I don't file the return for you, and I don't " +
  "provide tax advice. Ready to get started with your W-2?";

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify a user message as on-topic (allow) or off-topic / advice-seeking
 * (redirect). The redirect carries a warm reply that reminds the user this is
 * not tax advice and the assistant does not file the return.
 *
 * The classifier is deliberately rule-based — no LLM call — so the guardrail
 * is fast, deterministic, and auditable.
 */
export function classifyUserInput(message: string): GuardrailVerdict {
  const lower = message.toLowerCase().trim();

  // Short confirmations and numeric answers pass through regardless of content.
  if (SHORT_ANSWERS.has(lower) || /^\d[\d,.\s]*$/.test(lower)) {
    return { kind: 'allow' };
  }

  // Tax-advice-seeking check — run before keyword check so that a message
  // that mentions tax terms but is clearly asking for advice gets redirected
  // as advice-seeking rather than falling through to allow.
  for (const pattern of ADVICE_PATTERNS) {
    if (pattern.test(lower)) {
      return {
        kind: 'redirect',
        reason: 'tax-advice-seeking',
        reply: ADVICE_REDIRECT_REPLY,
      };
    }
  }

  // Off-topic check — if none of the tax keywords appear, redirect.
  const hasTaxKeyword = TAX_KEYWORDS.some((kw) => lower.includes(kw));
  if (!hasTaxKeyword) {
    return {
      kind: 'redirect',
      reason: 'off-topic',
      reply: OFFTOPIC_REDIRECT_REPLY,
    };
  }

  return { kind: 'allow' };
}

/** True if asking one more question would exceed the budget. */
export function budgetExhausted(questionsAsked: number): boolean {
  return questionsAsked >= QUESTION_BUDGET;
}