/**
 * A realistic fake W-2 for a ~$40k/year wage earner, used as the default test
 * input and as the "upload a sample" affordance in the chat UI. The figures
 * mirror the provided Sample-W2.pdf (Elizabeth A. Darling, University of
 * Pittsburgh, 2025), which is fictional test data — no real PII.
 */

import type { W2 } from '../domain/types.js';

export const SAMPLE_W2: W2 = {
  employeeName: 'Elizabeth A. Darling',
  employerName: 'University of Pittsburgh',
  wages: 44629.35,
  federalIncomeTaxWithheld: 7631.62,
  stateIncomeTaxWithheld: 1467.72,
};

/**
 * The same W-2 rendered as the raw text a user might paste into the chat,
 * so the W-2 parser can be exercised against messy real-world-ish input.
 */
export const SAMPLE_W2_PASTED = `
2025 W-2 Wage and Tax Statement
Employer: University of Pittsburgh, 4200 Fifth Avenue, Pittsburgh, PA 15260
Employee: Elizabeth A Darling, 2001 Campus Drive, Pittsburgh PA 15237
Box 1 Wages, tips, other comp: 44629.35
Box 2 Federal income tax withheld: 7631.62
Box 3 Social security wages: 48736.35
Box 4 Social security tax withheld: 3021.65
Box 5 Medicare wages and tips: 48736.35
Box 6 Medicare tax withheld: 706.68
Box 16 State wages: 47808.35
Box 17 State income tax: 1467.72
`.trim();
