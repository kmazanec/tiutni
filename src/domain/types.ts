/**
 * The frozen domain contract for the tax-filing assistant.
 *
 * Every feature module — the tax engine, the 1040 filler, the conversation
 * orchestrator, the guardrails — is built against these types. They are the one
 * handoff schema, so the fan-out stays coherent. Keep this file small and
 * behavior-free.
 */

/** 2025 Form 1040 filing statuses we support. */
export type FilingStatus =
  | 'single'
  | 'married_filing_jointly'
  | 'married_filing_separately'
  | 'head_of_household';

/**
 * The fields we read off a W-2. Amounts are dollars (numbers), already parsed
 * from the form's string cells. We only model the boxes a simple ~$40k W-2 wage
 * earner needs for a 1040; everything else on the form is ignored on purpose.
 */
export interface W2 {
  /** Box e — employee full name as printed. */
  employeeName: string;
  /** Box c — employer name as printed. */
  employerName: string;
  /** Box 1 — wages, tips, other compensation. */
  wages: number;
  /** Box 2 — federal income tax withheld. */
  federalIncomeTaxWithheld: number;
  /** Box 17 — state income tax withheld (informational; not on the federal 1040). */
  stateIncomeTaxWithheld?: number;
}

/**
 * The minimal set of answers the agent must collect from the user, on top of
 * the W-2, to compute a 2025 Form 1040. The 5-question budget is spent filling
 * this in. `filingStatus` and `dependents` are the only hard requirements;
 * everything else has a safe default the agent may confirm rather than ask.
 */
export interface TaxpayerProfile {
  filingStatus: FilingStatus;
  /** Number of dependents claimed (for the Child Tax / Credit for Other Dependents lines). */
  dependents: number;
  /** Whether the taxpayer can be claimed as a dependent by someone else (affects std deduction). */
  canBeClaimedAsDependent?: boolean;
}

/** Everything needed to compute the return: the W-2 plus the user's answers. */
export interface ReturnInput {
  w2: W2;
  profile: TaxpayerProfile;
}

/**
 * The computed 2025 Form 1040 figures. Line numbers follow the 2025 draft 1040.
 * All amounts are dollars, rounded to whole dollars for the form itself but kept
 * as numbers here.
 */
export interface Form1040 {
  filingStatus: FilingStatus;
  taxpayerName: string;
  /** Line 1a — total W-2 box 1 wages. */
  wages: number;
  /** Line 9 — total income. */
  totalIncome: number;
  /** Line 11 — adjusted gross income. */
  adjustedGrossIncome: number;
  /** Line 12 — standard deduction. */
  standardDeduction: number;
  /** Line 15 — taxable income. */
  taxableIncome: number;
  /** Line 16 — tax. */
  tax: number;
  /** Line 19 — child tax credit / credit for other dependents. */
  dependentCredit: number;
  /** Line 22 — tax after credits. */
  taxAfterCredits: number;
  /** Line 24 — total tax. */
  totalTax: number;
  /** Line 25a — federal income tax withheld from W-2. */
  withholding: number;
  /** Line 33 — total payments. */
  totalPayments: number;
  /** Line 34 — overpayment / refund (0 if owed). */
  refund: number;
  /** Line 37 — amount owed (0 if refund). */
  amountOwed: number;
}

/** Result of validating a W-2 before we trust it. */
export interface ValidationResult {
  ok: boolean;
  /** Human-readable problems, empty when ok. */
  errors: string[];
  /** Non-fatal notes the agent may surface gently (e.g. unusual but legal values). */
  warnings: string[];
}
