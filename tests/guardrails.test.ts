import { describe, it, expect } from 'vitest';
import {
  classifyUserInput,
  budgetExhausted,
  QUESTION_BUDGET,
} from '../src/agent/guardrails.js';

// ---------------------------------------------------------------------------
// classifyUserInput — on-topic (allow)
// ---------------------------------------------------------------------------

describe('classifyUserInput — on-topic (allow)', () => {
  it('allows a message about W-2 wages', () => {
    expect(classifyUserInput('My W-2 shows wages of $42,000')).toEqual({
      kind: 'allow',
    });
  });

  it('allows a message about filing status', () => {
    expect(classifyUserInput('I am married filing jointly')).toEqual({
      kind: 'allow',
    });
  });

  it('allows a message about dependents', () => {
    expect(classifyUserInput('I have two dependents')).toEqual({
      kind: 'allow',
    });
  });

  it('allows a message about withholding', () => {
    expect(classifyUserInput('Box 2 has $5,200 withheld')).toEqual({
      kind: 'allow',
    });
  });

  it('allows a message about a refund', () => {
    expect(classifyUserInput('What will my refund be?')).toEqual({
      kind: 'allow',
    });
  });

  it('allows a message about the 1040 form', () => {
    expect(classifyUserInput('I need to file my 1040')).toEqual({
      kind: 'allow',
    });
  });
});

// ---------------------------------------------------------------------------
// classifyUserInput — short answers
// ---------------------------------------------------------------------------

describe('classifyUserInput — short answers', () => {
  const shortAnswers = ['yes', 'no', 'ok', 'okay', 'sure', 'nope', 'yep', 'yeah', 'nah', 'maybe', 'idk', 'correct', 'right', 'wrong', 'thanks', 'thank you'];

  for (const answer of shortAnswers) {
    it(`allows "${answer}"`, () => {
      expect(classifyUserInput(answer)).toEqual({ kind: 'allow' });
    });
  }

  it('allows a numeric answer', () => {
    expect(classifyUserInput('2')).toEqual({ kind: 'allow' });
  });

  it('allows a short answer with extra whitespace', () => {
    expect(classifyUserInput('  yes  ')).toEqual({ kind: 'allow' });
  });
});

// ---------------------------------------------------------------------------
// classifyUserInput — tax-advice-seeking (redirect)
// ---------------------------------------------------------------------------

describe('classifyUserInput — tax-advice-seeking (redirect)', () => {
  it('redirects "should I contribute to an IRA"', () => {
    const v = classifyUserInput('Should I contribute to an IRA this year?');
    expect(v.kind).toBe('redirect');
    if (v.kind === 'redirect') {
      expect(v.reason).toBe('tax-advice-seeking');
      expect(v.reply).toContain("can't give tax advice");
      expect(v.reply).toContain("don't file your return");
    }
  });

  it('redirects "what is the best way to file"', () => {
    const v = classifyUserInput('what is the best way to file my taxes?');
    expect(v.kind).toBe('redirect');
    if (v.kind === 'redirect') {
      expect(v.reason).toBe('tax-advice-seeking');
    }
  });

  it('redirects "how can I avoid paying taxes"', () => {
    const v = classifyUserInput('how can I avoid paying taxes on my bonus?');
    expect(v.kind).toBe('redirect');
    if (v.kind === 'redirect') {
      expect(v.reason).toBe('tax-advice-seeking');
    }
  });

  it('redirects "is this deductible"', () => {
    const v = classifyUserInput('is this home office expense deductible?');
    expect(v.kind).toBe('redirect');
    if (v.kind === 'redirect') {
      expect(v.reason).toBe('tax-advice-seeking');
    }
  });

  it('redirects "can I claim my girlfriend"', () => {
    const v = classifyUserInput('can I claim my girlfriend as a dependent?');
    expect(v.kind).toBe('redirect');
    if (v.kind === 'redirect') {
      expect(v.reason).toBe('tax-advice-seeking');
    }
  });

  it('redirects "give me tax advice"', () => {
    const v = classifyUserInput('give me tax advice on my stock sales');
    expect(v.kind).toBe('redirect');
    if (v.kind === 'redirect') {
      expect(v.reason).toBe('tax-advice-seeking');
    }
  });

  it('redirects "what would you recommend"', () => {
    const v = classifyUserInput('what would you recommend for my deductions?');
    expect(v.kind).toBe('redirect');
    if (v.kind === 'redirect') {
      expect(v.reason).toBe('tax-advice-seeking');
    }
  });

  it('redirects "am I eligible for the earned income credit"', () => {
    const v = classifyUserInput('am I eligible for the earned income credit?');
    expect(v.kind).toBe('redirect');
    if (v.kind === 'redirect') {
      expect(v.reason).toBe('tax-advice-seeking');
    }
  });
});

// ---------------------------------------------------------------------------
// classifyUserInput — off-topic (redirect)
// ---------------------------------------------------------------------------

describe('classifyUserInput — off-topic (redirect)', () => {
  it('redirects a weather question', () => {
    const v = classifyUserInput("what's the weather like today?");
    expect(v.kind).toBe('redirect');
    if (v.kind === 'redirect') {
      expect(v.reason).toBe('off-topic');
      expect(v.reply).toContain("I'm here to help you prepare your 2025 Form 1040");
      expect(v.reply).toContain("don't provide tax advice");
    }
  });

  it('redirects a joke', () => {
    const v = classifyUserInput('tell me a joke');
    expect(v.kind).toBe('redirect');
    if (v.kind === 'redirect') {
      expect(v.reason).toBe('off-topic');
    }
  });

  it('redirects a sports question', () => {
    const v = classifyUserInput('who won the super bowl?');
    expect(v.kind).toBe('redirect');
    if (v.kind === 'redirect') {
      expect(v.reason).toBe('off-topic');
    }
  });

  it('redirects a food question', () => {
    const v = classifyUserInput('what should I eat for dinner?');
    expect(v.kind).toBe('redirect');
    if (v.kind === 'redirect') {
      expect(v.reason).toBe('off-topic');
    }
  });
});

// ---------------------------------------------------------------------------
// classifyUserInput — edge cases
// ---------------------------------------------------------------------------

describe('classifyUserInput — edge cases', () => {
  it('redirects an empty string (no tax keywords, not a short answer)', () => {
    const v = classifyUserInput('');
    expect(v.kind).toBe('redirect');
  });

  it('allows mixed-case input', () => {
    expect(classifyUserInput('My W-2 Wages Are $42,000')).toEqual({
      kind: 'allow',
    });
  });

  it('advice-seeking patterns are case-insensitive', () => {
    const v = classifyUserInput('SHOULD I FILE SEPARATELY?');
    expect(v.kind).toBe('redirect');
    if (v.kind === 'redirect') {
      expect(v.reason).toBe('tax-advice-seeking');
    }
  });
});

// ---------------------------------------------------------------------------
// budgetExhausted
// ---------------------------------------------------------------------------

describe('budgetExhausted', () => {
  it('returns false when no questions asked', () => {
    expect(budgetExhausted(0)).toBe(false);
  });

  it('returns false when one question remains', () => {
    expect(budgetExhausted(QUESTION_BUDGET - 1)).toBe(false);
  });

  it('returns true when budget is exactly consumed', () => {
    expect(budgetExhausted(QUESTION_BUDGET)).toBe(true);
  });

  it('returns true when budget is exceeded', () => {
    expect(budgetExhausted(QUESTION_BUDGET + 3)).toBe(true);
  });

  it('QUESTION_BUDGET is 5', () => {
    expect(QUESTION_BUDGET).toBe(5);
  });
});