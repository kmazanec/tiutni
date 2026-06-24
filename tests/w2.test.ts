import { describe, it, expect } from 'vitest';
import { parseW2, validateW2 } from '../src/tax/w2.js';
import { SAMPLE_W2, SAMPLE_W2_PASTED } from '../src/fixtures/sample-w2.js';
import type { W2 } from '../src/domain/types.js';

// ---------------------------------------------------------------------------
// parseW2
// ---------------------------------------------------------------------------

describe('parseW2', () => {
  it('parses the canonical SAMPLE_W2_PASTED text', () => {
    const result = parseW2(SAMPLE_W2_PASTED);
    expect(result).not.toBeNull();
    expect(result!.employeeName).toBe('Elizabeth A Darling');
    expect(result!.employerName).toBe('University of Pittsburgh');
    expect(result!.wages).toBe(44629.35);
    expect(result!.federalIncomeTaxWithheld).toBe(7631.62);
    expect(result!.stateIncomeTaxWithheld).toBe(1467.72);
  });

  it('parses text with dollar signs in box amounts', () => {
    const input = `
Box 1 Wages: $44,629.35
Box 2 Federal income tax withheld: $7,631.62
Employer: University of Pittsburgh
Employee: Elizabeth A Darling
`;
    const result = parseW2(input);
    expect(result).not.toBeNull();
    expect(result!.wages).toBe(44629.35);
    expect(result!.federalIncomeTaxWithheld).toBe(7631.62);
  });

  it('strips trailing address from employee / employer names', () => {
    const input = `
Employer: University of Pittsburgh, 4200 Fifth Avenue, Pittsburgh, PA 15260
Employee: Elizabeth A Darling, 2001 Campus Drive, Pittsburgh PA 15237
Box 1 Wages: 44629.35
Box 2 Federal income tax withheld: 7631.62
`;
    const result = parseW2(input);
    expect(result).not.toBeNull();
    expect(result!.employeeName).toBe('Elizabeth A Darling');
    expect(result!.employerName).toBe('University of Pittsburgh');
  });

  it('returns null for empty input', () => {
    expect(parseW2('')).toBeNull();
    expect(parseW2('   \n  ')).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    expect(parseW2('Box 1 Wages: 100')).toBeNull();
    expect(parseW2('Box 2 Federal income tax withheld: 50')).toBeNull();
    expect(parseW2('Employee: Jane')).toBeNull();
  });

  it('returns null when wages are missing but other fields present', () => {
    const input = `
Employee: Jane Doe
Employer: Acme Corp
Box 2 Federal income tax withheld: 5000
`;
    expect(parseW2(input)).toBeNull();
  });

  it('returns null when employer name is missing', () => {
    const input = `
Employee: Jane Doe
Box 1 Wages: 40000
Box 2 Federal income tax withheld: 5000
`;
    expect(parseW2(input)).toBeNull();
  });

  it('handles Box 17 (state tax) as optional — returns result without it', () => {
    const input = `
Employee: Jane Doe
Employer: Acme Corp
Box 1 Wages: 40000
Box 2 Federal income tax withheld: 5000
`;
    const result = parseW2(input);
    expect(result).not.toBeNull();
    expect(result!.stateIncomeTaxWithheld).toBeUndefined();
  });

  it('handles messy whitespace and line breaks', () => {
    const input = 'Employee:   Jane   Doe  \n\nEmployer:  Acme Corp\nBox  1  Wages:   40000.00\nBox 2  Federal income tax withheld: 5000.00';
    const result = parseW2(input);
    expect(result).not.toBeNull();
    expect(result!.employeeName).toBe('Jane   Doe');
    expect(result!.employerName).toBe('Acme Corp');
    expect(result!.wages).toBe(40000);
    expect(result!.federalIncomeTaxWithheld).toBe(5000);
  });

  it('accepts a trace and records events', () => {
    const events: Array<{ type: string; summary: string }> = [];
    const mockTrace = {
      record(type: string, summary: string) {
        events.push({ type, summary });
      },
    };

    const result = parseW2(SAMPLE_W2_PASTED, mockTrace as any);
    expect(result).not.toBeNull();
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]!.type).toBe('tool_call');
    expect(events[0]!.summary).toContain('parseW2');
  });
});

// ---------------------------------------------------------------------------
// validateW2
// ---------------------------------------------------------------------------

describe('validateW2', () => {
  it('passes the canonical SAMPLE_W2', () => {
    const result = validateW2(SAMPLE_W2);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('fails on missing employee name', () => {
    const w2: W2 = { ...SAMPLE_W2, employeeName: '' };
    const result = validateW2(w2);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Employee name is missing.');
  });

  it('fails on missing employer name', () => {
    const w2: W2 = { ...SAMPLE_W2, employerName: '   ' };
    const result = validateW2(w2);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Employer name is missing.');
  });

  it('fails on zero wages', () => {
    const w2: W2 = { ...SAMPLE_W2, wages: 0 };
    const result = validateW2(w2);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('positive'))).toBe(true);
  });

  it('fails on negative wages', () => {
    const w2: W2 = { ...SAMPLE_W2, wages: -100 };
    const result = validateW2(w2);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('positive'))).toBe(true);
  });

  it('fails on NaN wages', () => {
    const w2: W2 = { ...SAMPLE_W2, wages: NaN };
    const result = validateW2(w2);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('number'))).toBe(true);
  });

  it('fails on negative federal withholding', () => {
    const w2: W2 = { ...SAMPLE_W2, federalIncomeTaxWithheld: -1 };
    const result = validateW2(w2);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('negative'))).toBe(true);
  });

  it('fails when withholding exceeds wages', () => {
    const w2: W2 = { ...SAMPLE_W2, wages: 1000, federalIncomeTaxWithheld: 2000 };
    const result = validateW2(w2);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('exceeds wages'))).toBe(true);
  });

  it('warns when withholding is more than 50% of wages', () => {
    const w2: W2 = { ...SAMPLE_W2, wages: 10000, federalIncomeTaxWithheld: 6000 };
    const result = validateW2(w2);
    expect(result.ok).toBe(true); // not an error, just a warning
    expect(result.warnings.some((w) => w.includes('50%'))).toBe(true);
  });

  it('passes with zero federal withholding (unusual but legal)', () => {
    const w2: W2 = { ...SAMPLE_W2, federalIncomeTaxWithheld: 0 };
    const result = validateW2(w2);
    expect(result.ok).toBe(true);
  });

  it('fails on negative state tax withheld', () => {
    const w2: W2 = { ...SAMPLE_W2, stateIncomeTaxWithheld: -5 };
    const result = validateW2(w2);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Box 17'))).toBe(true);
  });

  it('fails on NaN state tax withheld', () => {
    const w2: W2 = { ...SAMPLE_W2, stateIncomeTaxWithheld: NaN };
    const result = validateW2(w2);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Box 17'))).toBe(true);
  });

  it('passes when stateIncomeTaxWithheld is undefined', () => {
    const { stateIncomeTaxWithheld: _, ...w2WithoutState } = SAMPLE_W2;
    const result = validateW2(w2WithoutState);
    expect(result.ok).toBe(true);
  });

  it('accumulates multiple errors', () => {
    const w2: W2 = {
      employeeName: '',
      employerName: '',
      wages: 100,
      federalIncomeTaxWithheld: 999999,
    };
    const result = validateW2(w2);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
    expect(result.errors.some((e) => e.includes('Employee name'))).toBe(true);
    expect(result.errors.some((e) => e.includes('Employer name'))).toBe(true);
    expect(result.errors.some((e) => e.includes('exceeds wages'))).toBe(true);
  });

  it('accepts a trace and records events', () => {
    const events: Array<{ type: string; summary: string }> = [];
    const mockTrace = {
      record(type: string, summary: string) {
        events.push({ type, summary });
      },
    };

    const result = validateW2(SAMPLE_W2, mockTrace as any);
    expect(result.ok).toBe(true);
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events[0]!.type).toBe('tool_call');
    expect(events[0]!.summary).toContain('validateW2');
  });
});