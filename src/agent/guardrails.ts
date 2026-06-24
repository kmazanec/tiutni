/**
 * Guardrails (Pillar 3): the constraints that keep the agent on-task, safe, and
 * bounded. These are CODE-enforced, not prompt-suggested:
 *
 *   - the 5-question budget is a hard counter the orchestrator cannot exceed;
 *   - off-topic / advice-seeking input is classified and redirected;
 *   - every value the agent accepts is schema/range validated before use;
 *   - the agent never claims to give tax advice or to file the return.
 *
 * NOTE (scaffold stub): the real classifiers and validators are delivered by the
 * corellia fan-out. Stubs define the contract.
 */

export const QUESTION_BUDGET = 5;

export type GuardrailVerdict =
  | { kind: 'allow' }
  | { kind: 'redirect'; reason: string; reply: string };

export function classifyUserInput(_message: string): GuardrailVerdict {
  throw new Error('guardrail classifier not yet built — pending corellia fan-out');
}

/** True if asking one more question would exceed the budget. */
export function budgetExhausted(questionsAsked: number): boolean {
  return questionsAsked >= QUESTION_BUDGET;
}
