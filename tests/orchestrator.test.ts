import { describe, it, expect } from 'vitest';
import { handleTurn } from '../src/agent/orchestrator.js';
import { createSessionStore } from '../src/server/sessions.js';

function newSession() {
  return createSessionStore().create();
}

describe('orchestrator — full happy path within 5 questions', () => {
  it('walks a single filer from greeting to a completed return using the sample W-2', async () => {
    const s = newSession();

    const greeting = await handleTurn(s, null);
    expect(greeting.done).toBe(false);
    expect(greeting.reply.toLowerCase()).toContain('1040');

    const afterW2 = await handleTurn(s, 'use the sample');
    expect(afterW2.reply).toContain('Elizabeth');
    expect(afterW2.reply.toLowerCase()).toContain('filing status');

    const afterStatus = await handleTurn(s, 'single');
    expect(afterStatus.reply.toLowerCase()).toContain('dependent');

    const afterDeps = await handleTurn(s, 'none');
    expect(afterDeps.done).toBe(true);

    // The return is computed and downloadable.
    expect(s.completed).toBe(true);
    expect(s.form1040).toBeDefined();
    expect(s.form1040?.refund).toBe(4_315); // matches the engine's sample-W-2 numbers

    // Budget respected: at most 5 questions were put to the user.
    expect(s.questionsAsked).toBeLessThanOrEqual(5);
  });

  it('never exceeds the 5-question budget even with re-prompts', async () => {
    const s = newSession();
    await handleTurn(s, null);
    await handleTurn(s, 'use the sample');
    // Garbage status answers cause re-prompts but must not charge new questions.
    await handleTurn(s, 'asdf');
    await handleTurn(s, 'qwer');
    await handleTurn(s, 'single');
    await handleTurn(s, '2');
    expect(s.questionsAsked).toBeLessThanOrEqual(5);
    expect(s.completed).toBe(true);
  });

  it('redirects off-topic input without breaking the flow', async () => {
    const s = newSession();
    await handleTurn(s, null);
    const off = await handleTurn(s, 'what is the weather today');
    expect(off.reply.toLowerCase()).toContain('1040');
    expect(s.completed).toBe(false);
  });

  it('refuses to give tax advice', async () => {
    const s = newSession();
    await handleTurn(s, null);
    const advice = await handleTurn(s, 'should I itemize or take the standard deduction?');
    expect(advice.reply.toLowerCase()).toContain("can't give tax advice");
  });

  it('supports a married-filing-jointly filer with a dependent', async () => {
    const s = newSession();
    await handleTurn(s, null);
    await handleTurn(s, 'use the sample');
    await handleTurn(s, 'married filing jointly');
    const done = await handleTurn(s, '1');
    expect(done.done).toBe(true);
    expect(s.form1040?.filingStatus).toBe('married_filing_jointly');
    expect(s.form1040?.standardDeduction).toBe(30_000);
    expect(s.form1040?.dependentCredit).toBe(2_000);
  });
});
