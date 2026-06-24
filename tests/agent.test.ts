import { describe, it, expect } from 'vitest';
import { runAgentTurn } from '../src/agent/agent.js';
import { createSessionStore } from '../src/server/sessions.js';
import { stubLlm } from './helpers/stub-llm.js';

function newSession() {
  return createSessionStore().create();
}

describe('agent loop — LLM-driven, code-enforced rails', () => {
  it('drives a full single-filer conversation via tool calls to a finished return', async () => {
    const s = newSession();

    // Greeting turn: the agent asks for the W-2.
    const greet = stubLlm([{ text: 'Hi! I can help with your 2025 Form 1040. Do you have your W-2 handy — upload it, paste it, or say "use the sample"?' }]);
    const g = await runAgentTurn(s, greet, null);
    expect(g.done).toBe(false);
    expect(s.questionsAsked).toBe(1);

    // User: "use the sample" → agent calls use_sample_w2, then asks filing status.
    const t1 = stubLlm([
      { tools: [{ name: 'use_sample_w2' }] },
      { text: 'Great, I loaded the sample W-2 for Elizabeth. What is your filing status?' },
    ]);
    await runAgentTurn(s, t1, 'use the sample');
    expect(s.w2?.wages).toBe(44629.35);
    expect(s.questionsAsked).toBe(2);

    // User: "single" → agent records status, asks about dependents.
    const t2 = stubLlm([
      { tools: [{ name: 'set_filing_status', args: { status: 'single' } }] },
      { text: 'Thanks! How many dependents will you claim? (0 if none.)' },
    ]);
    await runAgentTurn(s, t2, 'single');
    expect(s.profile.filingStatus).toBe('single');
    expect(s.questionsAsked).toBe(3);

    // User: "none" → agent records 0, computes, finalizes.
    const t3 = stubLlm([
      { tools: [{ name: 'set_dependents', args: { count: 0 } }] },
      { tools: [{ name: 'compute_and_finalize_return' }] },
      { text: "All done! You're getting a refund of $4,405. You can download your completed 1040 now." },
    ]);
    const done = await runAgentTurn(s, t3, 'none');
    expect(done.done).toBe(true);
    expect(s.completed).toBe(true);
    expect(s.form1040?.refund).toBe(4405);
    // Budget respected.
    expect(s.questionsAsked).toBeLessThanOrEqual(5);
  });

  it('rejects an invalid filing status at the tool boundary (code guardrail)', async () => {
    const s = newSession();
    s.w2 = { employeeName: 'X', employerName: 'Y', wages: 40000, federalIncomeTaxWithheld: 3000 };
    // The model tries to set a bogus status; the tool executor must reject it.
    const llm = stubLlm([
      { tools: [{ name: 'set_filing_status', args: { status: 'martian' } }] },
      { text: "Sorry, which filing status — single, married filing jointly, separately, or head of household?" },
    ]);
    await runAgentTurn(s, llm, 'martian');
    expect(s.profile.filingStatus).toBeUndefined();
  });

  it('blocks finalize until all inputs are present (code guardrail)', async () => {
    const s = newSession();
    // Only a W-2, no status/dependents. The model calls finalize prematurely.
    s.w2 = { employeeName: 'X', employerName: 'Y', wages: 40000, federalIncomeTaxWithheld: 3000 };
    const llm = stubLlm([
      { tools: [{ name: 'compute_and_finalize_return' }] },
      { text: 'I still need your filing status first.' },
    ]);
    const turn = await runAgentTurn(s, llm, 'just finish it');
    expect(s.completed).toBe(false);
    expect(turn.done).toBe(false);
  });

  it('redirects tax-advice requests before any LLM turn (code guardrail)', async () => {
    const s = newSession();
    const llm = stubLlm([{ text: 'this should never be returned' }]);
    const turn = await runAgentTurn(s, llm, 'should I itemize or take the standard deduction?');
    expect(turn.reply.toLowerCase()).toContain("can't give tax advice");
  });

  it('enforces the 5-question budget: the system note tells the model when it is out', async () => {
    const s = newSession();
    s.questionsAsked = 5; // budget already spent
    // With the budget exhausted, the agent should finalize using safe defaults
    // rather than asking again. Give it a W-2 + status; model finalizes.
    s.w2 = { employeeName: 'X', employerName: 'Y', wages: 40000, federalIncomeTaxWithheld: 3000 };
    s.profile.filingStatus = 'single';
    const llm = stubLlm([
      { tools: [{ name: 'set_dependents', args: { count: 0 } }] },
      { tools: [{ name: 'compute_and_finalize_return' }] },
      { text: 'All set — your return is ready to download.' },
    ]);
    const turn = await runAgentTurn(s, llm, 'ok');
    expect(turn.done).toBe(true);
    expect(s.completed).toBe(true);
    // No new question was charged beyond the budget.
    expect(s.questionsAsked).toBe(5);
  });
});
