/**
 * Exhaustive unit tests for the 2025 federal tax engine (computeReturn).
 *
 * Covers:
 *  - Sample W-2 (Elizabeth Darling, single, 0 dependents)
 *  - All four filing statuses with the same wages
 *  - Dependent standard deduction
 *  - CTC for multiple dependents
 *  - Edge cases: zero wages, exact bracket boundaries, refund vs. amount owed
 */

import { describe, it, expect } from 'vitest';
import { computeReturn } from '../src/tax/engine.js';
import { SAMPLE_W2 } from '../src/fixtures/sample-w2.js';
import type { ReturnInput, FilingStatus, W2 } from '../src/domain/types.js';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Build a ReturnInput with the sample W-2 and the given profile overrides. */
function makeInput(overrides: {
  filingStatus?: FilingStatus;
  dependents?: number;
  canBeClaimedAsDependent?: boolean;
  w2?: W2;
}): ReturnInput {
  return {
    w2: overrides.w2 ?? SAMPLE_W2,
    profile: {
      filingStatus: overrides.filingStatus ?? 'single',
      dependents: overrides.dependents ?? 0,
      canBeClaimedAsDependent: overrides.canBeClaimedAsDependent,
    },
  };
}

// ---------------------------------------------------------------------------
// Sample W-2 scenario
// ---------------------------------------------------------------------------

describe('sample W-2 (Elizabeth Darling, single, 0 dependents)', () => {
  const result = computeReturn(makeInput({}));

  it('rounds wages to whole dollars', () => {
    expect(result.wages).toBe(44_629);
  });

  it('rounds withholding to whole dollars', () => {
    expect(result.withholding).toBe(7_632);
  });

  it('total income equals wages', () => {
    expect(result.totalIncome).toBe(44_629);
  });

  it('AGI equals total income (no adjustments)', () => {
    expect(result.adjustedGrossIncome).toBe(44_629);
  });

  it('standard deduction for single is $15,750', () => {
    expect(result.standardDeduction).toBe(15_750);
  });

  it('taxable income is AGI minus standard deduction', () => {
    // 44629 - 15750 = 28879
    expect(result.taxableIncome).toBe(28_879);
  });

  it('tax is computed from 2025 brackets', () => {
    // 28879 taxable: first 11925 @ 10% = 1192.50, remaining 16954 @ 12% = 2034.48
    // total = 3226.98, rounded = 3227
    expect(result.tax).toBe(3_227);
  });

  it('no dependent credit', () => {
    expect(result.dependentCredit).toBe(0);
  });

  it('tax after credits equals tax', () => {
    expect(result.taxAfterCredits).toBe(3_227);
  });

  it('total tax equals tax after credits', () => {
    expect(result.totalTax).toBe(3_227);
  });

  it('refund is withholding minus total tax', () => {
    // 7632 - 3227 = 4405
    expect(result.refund).toBe(4_405);
  });

  it('amount owed is zero since withholding exceeds tax', () => {
    expect(result.amountOwed).toBe(0);
  });

  it('taxpayer name is from W-2', () => {
    expect(result.taxpayerName).toBe('Elizabeth A. Darling');
  });

  it('filing status is preserved', () => {
    expect(result.filingStatus).toBe('single');
  });
});

// ---------------------------------------------------------------------------
// Standard deductions by filing status
// ---------------------------------------------------------------------------

describe('standard deductions', () => {
  it('single: $15,750', () => {
    const r = computeReturn(makeInput({ filingStatus: 'single' }));
    expect(r.standardDeduction).toBe(15_750);
  });

  it('married filing jointly: $31,500', () => {
    const r = computeReturn(makeInput({ filingStatus: 'married_filing_jointly' }));
    expect(r.standardDeduction).toBe(31_500);
  });

  it('married filing separately: $15,750', () => {
    const r = computeReturn(makeInput({ filingStatus: 'married_filing_separately' }));
    expect(r.standardDeduction).toBe(15_750);
  });

  it('head of household: $23,625', () => {
    const r = computeReturn(makeInput({ filingStatus: 'head_of_household' }));
    expect(r.standardDeduction).toBe(23_625);
  });
});

// ---------------------------------------------------------------------------
// Dependent standard deduction
// ---------------------------------------------------------------------------

describe('dependent standard deduction', () => {
  it('defaults to normal deduction when not a dependent', () => {
    const r = computeReturn(makeInput({ canBeClaimedAsDependent: false }));
    expect(r.standardDeduction).toBe(15_750); // single
  });

  it('uses greater of $1,350 or earned income + $450 when a dependent', () => {
    const r = computeReturn(makeInput({
      canBeClaimedAsDependent: true,
      w2: { ...SAMPLE_W2, wages: 10_000 },
    }));
    // 10000 + 450 = 10450, which is > 1350, so 10450 (capped at 15750)
    expect(r.standardDeduction).toBe(10_450);
  });

  it('uses $1,350 floor when earned income is very low', () => {
    const r = computeReturn(makeInput({
      canBeClaimedAsDependent: true,
      w2: { ...SAMPLE_W2, wages: 500 },
    }));
    // 500 + 450 = 950, which is < 1350, so floor of 1350
    expect(r.standardDeduction).toBe(1_350);
  });

  it('caps at the normal deduction for the filing status', () => {
    const r = computeReturn(makeInput({
      canBeClaimedAsDependent: true,
      w2: { ...SAMPLE_W2, wages: 50_000 },
    }));
    // 50000 + 450 = 50450, but capped at 15750 (single)
    expect(r.standardDeduction).toBe(15_750);
  });
});

// ---------------------------------------------------------------------------
// Tax bracket calculations
// ---------------------------------------------------------------------------

describe('tax bracket calculations', () => {
  it('zero taxable income = zero tax', () => {
    const r = computeReturn(makeInput({
      w2: { ...SAMPLE_W2, wages: 0, federalIncomeTaxWithheld: 0 },
    }));
    expect(r.taxableIncome).toBe(0);
    expect(r.tax).toBe(0);
  });

  it('single, taxable at top of 10% bracket', () => {
    // 11925 @ 10% = 1192.50 → 1193
    const w2: W2 = { ...SAMPLE_W2, wages: 11_925 + 15_750, federalIncomeTaxWithheld: 0 };
    // wages = 27675, std = 15750, taxable = 11925
    const r = computeReturn(makeInput({ w2 }));
    expect(r.taxableIncome).toBe(11_925);
    expect(r.tax).toBe(1_193);
  });

  it('single, taxable in 12% bracket', () => {
    // taxable = 20000: 11925 @ 10% = 1192.50, 8075 @ 12% = 969.00, total = 2161.50 → 2162
    const w2: W2 = { ...SAMPLE_W2, wages: 20_000 + 15_750, federalIncomeTaxWithheld: 0 };
    const r = computeReturn(makeInput({ w2 }));
    expect(r.taxableIncome).toBe(20_000);
    expect(r.tax).toBe(2_162);
  });

  it('single, taxable at top of 12% bracket', () => {
    // taxable = 48475: 11925 @ 10% = 1192.50, 36550 @ 12% = 4386.00, total = 5578.50 → 5579
    const w2: W2 = { ...SAMPLE_W2, wages: 48_475 + 15_750, federalIncomeTaxWithheld: 0 };
    const r = computeReturn(makeInput({ w2 }));
    expect(r.taxableIncome).toBe(48_475);
    expect(r.tax).toBe(5_579);
  });

  it('single, taxable in 22% bracket', () => {
    // taxable = 60000:
    //  11925 @ 10% = 1192.50
    //  36550 @ 12% = 4386.00
    //  11525 @ 22% = 2535.50
    //  total = 8114.00 → 8114
    const w2: W2 = { ...SAMPLE_W2, wages: 60_000 + 15_750, federalIncomeTaxWithheld: 0 };
    const r = computeReturn(makeInput({ w2 }));
    expect(r.taxableIncome).toBe(60_000);
    expect(r.tax).toBe(8_114);
  });

  it('MFJ, taxable income spread across brackets', () => {
    // taxable = 100000:
    //  23850 @ 10% = 2385.00
    //  73100 @ 12% = 8772.00
    //  3050 @ 22% = 671.00
    //  total = 11828.00 → 11828
    const w2: W2 = { ...SAMPLE_W2, wages: 100_000 + 31_500, federalIncomeTaxWithheld: 0 };
    const r = computeReturn(makeInput({ filingStatus: 'married_filing_jointly', w2 }));
    expect(r.taxableIncome).toBe(100_000);
    expect(r.tax).toBe(11_828);
  });

  it('head of household, taxable income in 12% bracket', () => {
    // taxable = 30000:
    //  17000 @ 10% = 1700.00
    //  13000 @ 12% = 1560.00
    //  total = 3260.00 → 3260
    const w2: W2 = { ...SAMPLE_W2, wages: 30_000 + 23_625, federalIncomeTaxWithheld: 0 };
    const r = computeReturn(makeInput({ filingStatus: 'head_of_household', w2 }));
    expect(r.taxableIncome).toBe(30_000);
    expect(r.tax).toBe(3_260);
  });
});

// ---------------------------------------------------------------------------
// Child Tax Credit / dependents
// ---------------------------------------------------------------------------

describe('dependent credit', () => {
  it('1 dependent = $2,000 CTC', () => {
    const r = computeReturn(makeInput({ dependents: 1 }));
    expect(r.dependentCredit).toBe(2_000);
  });

  it('2 dependents = $4,000 CTC', () => {
    const r = computeReturn(makeInput({ dependents: 2 }));
    expect(r.dependentCredit).toBe(4_000);
  });

  it('CTC reduces tax, not below zero', () => {
    // With sample W-2 wages, tax is 3227. 2 dependents = 4000 credit, tax after credits = 0.
    const r = computeReturn(makeInput({ dependents: 2 }));
    expect(r.tax).toBe(3_227);
    expect(r.dependentCredit).toBe(4_000);
    expect(r.taxAfterCredits).toBe(0);
    expect(r.totalTax).toBe(0);
  });

  it('refund increases when CTC reduces tax', () => {
    const r = computeReturn(makeInput({ dependents: 2 }));
    // withholding 7632, total tax 0 → refund 7632
    expect(r.refund).toBe(7_632);
    expect(r.amountOwed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Refund vs. amount owed
// ---------------------------------------------------------------------------

describe('refund vs amount owed', () => {
  it('refund when withholding > tax', () => {
    const r = computeReturn(makeInput({}));
    expect(r.refund).toBeGreaterThan(0);
    expect(r.amountOwed).toBe(0);
  });

  it('amount owed when withholding < tax', () => {
    const w2: W2 = { ...SAMPLE_W2, wages: 100_000, federalIncomeTaxWithheld: 1_000 };
    // wages = 100000, std = 15750, taxable = 84250
    // tax on 84250: 11925 @ 10% + 36550 @ 12% + 35775 @ 22%
    // = 1192.50 + 4386.00 + 7870.50 = 13449.00 → 13449
    // withholding = 1000, owed = 12449
    const r = computeReturn(makeInput({ w2 }));
    expect(r.amountOwed).toBeGreaterThan(0);
    expect(r.refund).toBe(0);
    expect(r.amountOwed).toBe(12_449);
  });

  it('zero refund and zero owed when exact match', () => {
    // taxable = 20000, tax = 2162 (as computed above)
    const w2: W2 = { ...SAMPLE_W2, wages: 35_750, federalIncomeTaxWithheld: 2_162 };
    const r = computeReturn(makeInput({ w2 }));
    expect(r.tax).toBe(2_162);
    expect(r.withholding).toBe(2_162);
    expect(r.refund).toBe(0);
    expect(r.amountOwed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Rounding edge cases
// ---------------------------------------------------------------------------

describe('dollar rounding', () => {
  it('rounds 0.50 up', () => {
    // wages = 10000.50 → 10001
    const w2: W2 = { ...SAMPLE_W2, wages: 10_000.50, federalIncomeTaxWithheld: 0 };
    const r = computeReturn(makeInput({ w2 }));
    expect(r.wages).toBe(10_001);
  });

  it('rounds 0.49 down', () => {
    const w2: W2 = { ...SAMPLE_W2, wages: 10_000.49, federalIncomeTaxWithheld: 0 };
    const r = computeReturn(makeInput({ w2 }));
    expect(r.wages).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// All filing statuses with sample wages
// ---------------------------------------------------------------------------

describe('all filing statuses with sample W-2 wages', () => {
  const statuses: FilingStatus[] = [
    'single',
    'married_filing_jointly',
    'married_filing_separately',
    'head_of_household',
  ];

  for (const status of statuses) {
    it(`produces a valid return for ${status}`, () => {
      const r = computeReturn(makeInput({ filingStatus: status }));
      expect(r.filingStatus).toBe(status);
      expect(r.wages).toBe(44_629);
      expect(r.totalIncome).toBe(r.wages);
      expect(r.adjustedGrossIncome).toBe(r.totalIncome);
      expect(r.standardDeduction).toBeGreaterThan(0);
      expect(r.taxableIncome).toBe(r.adjustedGrossIncome - r.standardDeduction);
      expect(r.tax).toBeGreaterThanOrEqual(0);
      expect(r.taxAfterCredits).toBeGreaterThanOrEqual(0);
      expect(r.totalTax).toBe(r.taxAfterCredits);
      expect(r.totalPayments).toBe(r.withholding);
      // Either refund or amountOwed is zero, never both positive
      expect(r.refund === 0 || r.amountOwed === 0).toBe(true);
      expect(r.refund >= 0).toBe(true);
      expect(r.amountOwed >= 0).toBe(true);
    });
  }
});
