/**
 * The 2025 federal tax engine. Pure, deterministic, fully unit-tested — this is
 * the part of the harness that MUST be correct, so it is plain arithmetic with
 * no LLM in the loop. Given a ReturnInput, it produces the Form1040 line values.
 *
 * All amounts are rounded to whole dollars on the form lines, following IRS
 * rounding conventions (0.50 rounds up).
 */

import type { ReturnInput, Form1040, FilingStatus } from '../domain/types.js';

// ---------------------------------------------------------------------------
// 2025 official figures (Rev. Proc. 2024-40, inflation-adjusted)
// ---------------------------------------------------------------------------

/** 2025 standard deduction by filing status. */
const STANDARD_DEDUCTION: Record<FilingStatus, number> = {
  single: 15_000,
  married_filing_jointly: 30_000,
  married_filing_separately: 15_000,
  head_of_household: 22_500,
};

/** 2025 standard deduction for a dependent: greater of $1,300 or earned income + $450, capped at the normal deduction. */
const DEPENDENT_MIN_STD = 1_300;
const DEPENDENT_EARNED_ADD = 450;

// ---------------------------------------------------------------------------
// 2025 federal income tax brackets
// ---------------------------------------------------------------------------

interface Bracket {
  ceiling: number; // upper bound of this bracket (exclusive endpoint; use Infinity for top)
  rate: number;    // marginal rate as a decimal (e.g. 0.10)
}

const BRACKETS: Record<FilingStatus, Bracket[]> = {
  single: [
    { ceiling: 11_925, rate: 0.10 },
    { ceiling: 48_475, rate: 0.12 },
    { ceiling: 103_350, rate: 0.22 },
    { ceiling: 197_300, rate: 0.24 },
    { ceiling: 250_525, rate: 0.32 },
    { ceiling: 626_350, rate: 0.35 },
    { ceiling: Infinity, rate: 0.37 },
  ],
  married_filing_jointly: [
    { ceiling: 23_850, rate: 0.10 },
    { ceiling: 96_950, rate: 0.12 },
    { ceiling: 206_700, rate: 0.22 },
    { ceiling: 394_600, rate: 0.24 },
    { ceiling: 501_050, rate: 0.32 },
    { ceiling: 751_600, rate: 0.35 },
    { ceiling: Infinity, rate: 0.37 },
  ],
  married_filing_separately: [
    { ceiling: 11_925, rate: 0.10 },
    { ceiling: 48_475, rate: 0.12 },
    { ceiling: 103_350, rate: 0.22 },
    { ceiling: 197_300, rate: 0.24 },
    { ceiling: 250_525, rate: 0.32 },
    { ceiling: 375_800, rate: 0.35 },
    { ceiling: Infinity, rate: 0.37 },
  ],
  head_of_household: [
    { ceiling: 17_000, rate: 0.10 },
    { ceiling: 64_850, rate: 0.12 },
    { ceiling: 103_350, rate: 0.22 },
    { ceiling: 197_300, rate: 0.24 },
    { ceiling: 250_525, rate: 0.32 },
    { ceiling: 626_350, rate: 0.35 },
    { ceiling: Infinity, rate: 0.37 },
  ],
};

/** 2025 Child Tax Credit per qualifying dependent. No phaseout at AGI levels this engine handles. */
const CHILD_TAX_CREDIT_PER_DEPENDENT = 2_000;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Round a dollar amount to the nearest whole dollar.
 * 0.50 rounds up (standard IRS rounding).
 */
function roundDollar(amount: number): number {
  return Math.round(amount);
}

/**
 * Compute tax from taxable income using the progressive bracket table.
 */
function computeTax(taxableIncome: number, brackets: Bracket[]): number {
  let remaining = taxableIncome;
  let tax = 0;
  let previousCeiling = 0;

  for (const bracket of brackets) {
    const width = bracket.ceiling - previousCeiling;
    const taxedInBracket = Math.min(remaining, width);
    tax += taxedInBracket * bracket.rate;
    remaining -= taxedInBracket;
    if (remaining <= 0) break;
    previousCeiling = bracket.ceiling;
  }

  return roundDollar(tax);
}

// ---------------------------------------------------------------------------
// main entry point
// ---------------------------------------------------------------------------

export function computeReturn(input: ReturnInput): Form1040 {
  const { w2, profile } = input;
  const filingStatus = profile.filingStatus;
  const wages = roundDollar(w2.wages);

  // Line 9: total income — only W-2 wages for this simple earner.
  const totalIncome = wages;

  // Line 11: adjusted gross income — no adjustments (no IRA, student loan, etc.).
  const adjustedGrossIncome = totalIncome;

  // Line 12: standard deduction.
  const normalStd = STANDARD_DEDUCTION[filingStatus];
  let standardDeduction: number;
  if (profile.canBeClaimedAsDependent) {
    // Dependent standard deduction = greater of $1,300 or earned income + $450, capped at the normal deduction.
    const dependentLimit = Math.max(DEPENDENT_MIN_STD, wages + DEPENDENT_EARNED_ADD);
    standardDeduction = Math.min(dependentLimit, normalStd);
  } else {
    standardDeduction = normalStd;
  }

  // Line 15: taxable income (never below zero).
  const taxableIncome = Math.max(0, adjustedGrossIncome - standardDeduction);

  // Line 16: tax from bracket table.
  const tax = computeTax(taxableIncome, BRACKETS[filingStatus]);

  // Line 19: dependent credit (CTC — all dependents treated as qualifying children at $2,000 each, no phaseout).
  const dependentCredit = profile.dependents * CHILD_TAX_CREDIT_PER_DEPENDENT;

  // Line 22: tax after credits (never below zero — CTC is non-refundable for this simplified engine).
  const taxAfterCredits = Math.max(0, tax - dependentCredit);

  // Line 24: total tax.
  const totalTax = taxAfterCredits;

  // Line 25a: federal income tax withheld.
  const withholding = roundDollar(w2.federalIncomeTaxWithheld);

  // Line 33: total payments.
  const totalPayments = withholding;

  // Lines 34 & 37: refund or amount owed.
  const refund = totalPayments > totalTax ? totalPayments - totalTax : 0;
  const amountOwed = totalTax > totalPayments ? totalTax - totalPayments : 0;

  return {
    filingStatus,
    taxpayerName: w2.employeeName,
    wages,
    totalIncome,
    adjustedGrossIncome,
    standardDeduction,
    taxableIncome,
    tax,
    dependentCredit,
    taxAfterCredits,
    totalTax,
    withholding,
    totalPayments,
    refund,
    amountOwed,
  };
}
