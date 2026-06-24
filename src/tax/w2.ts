/**
 * W-2 ingestion + validation (Pillar 3 guardrails on input). Parses a W-2 from
 * pasted text, and validates the parsed result before the engine is allowed to
 * trust it.
 */

import type { W2, ValidationResult } from '../domain/types.js';
import type { Trace } from '../observe/trace.js';

/**
 * Parse pasted W-2 text into the W2 domain shape. Returns null when the text
 * does not contain enough signal to extract a W-2 — the caller must ask the
 * user to re-paste or provide the missing fields manually.
 *
 * The parser handles the common "Box N label: amount" format that appears when
 * users copy a W-2 from a PDF or a payroll portal. It is intentionally lenient
 * about whitespace, line breaks, and surrounding noise.
 */
export function parseW2(raw: string, trace?: Trace): W2 | null {
  trace?.record('tool_call', 'parseW2: attempting to parse pasted W-2 text');

  if (!raw || raw.trim().length === 0) {
    trace?.record('guardrail', 'parseW2: empty input, cannot parse');
    return null;
  }

  const cleaned = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const employeeName = extractName(cleaned, /Employee\s*:\s*(.+)/i);
  const employerName = extractName(cleaned, /Employer\s*:\s*(.+)/i);
  const wages = extractBoxAmount(cleaned, 1);
  const federalIncomeTaxWithheld = extractBoxAmount(cleaned, 2);
  const stateIncomeTaxWithheld = extractBoxAmount(cleaned, 17);

  if (employeeName === null || employerName === null || wages === null || federalIncomeTaxWithheld === null) {
    trace?.record('guardrail', 'parseW2: missing required fields', {
      hasEmployeeName: employeeName !== null,
      hasEmployerName: employerName !== null,
      hasWages: wages !== null,
      hasFederalWithholding: federalIncomeTaxWithheld !== null,
    });
    return null;
  }

  const result: W2 = {
    employeeName,
    employerName,
    wages,
    federalIncomeTaxWithheld,
    ...(stateIncomeTaxWithheld !== null ? { stateIncomeTaxWithheld } : {}),
  };

  trace?.record('tool_result', 'parseW2: successfully parsed W-2', {
    employeeName,
    employerName,
    wages,
    federalIncomeTaxWithheld,
    stateIncomeTaxWithheld,
  });

  return result;
}

/**
 * Validate a parsed W-2 against range and schema constraints. Returns a
 * ValidationResult with any errors (hard blockers) and warnings (non-fatal
 * notes the agent may surface gently).
 */
export function validateW2(w2: W2, trace?: Trace): ValidationResult {
  trace?.record('tool_call', 'validateW2: running validation');

  const errors: string[] = [];
  const warnings: string[] = [];

  // --- employeeName ---
  if (!w2.employeeName || w2.employeeName.trim().length === 0) {
    errors.push('Employee name is missing.');
  }

  // --- employerName ---
  if (!w2.employerName || w2.employerName.trim().length === 0) {
    errors.push('Employer name is missing.');
  }

  // --- wages ---
  if (typeof w2.wages !== 'number' || Number.isNaN(w2.wages)) {
    errors.push('Wages (Box 1) must be a number.');
  } else if (w2.wages <= 0) {
    errors.push('Wages (Box 1) must be positive.');
  }

  // --- federalIncomeTaxWithheld ---
  if (typeof w2.federalIncomeTaxWithheld !== 'number' || Number.isNaN(w2.federalIncomeTaxWithheld)) {
    errors.push('Federal income tax withheld (Box 2) must be a number.');
  } else if (w2.federalIncomeTaxWithheld < 0) {
    errors.push('Federal income tax withheld (Box 2) cannot be negative.');
  }

  // --- cross-field: withholding vs wages ---
  // Only check when both are valid numbers so we don't double-report.
  if (
    typeof w2.wages === 'number' && !Number.isNaN(w2.wages) && w2.wages > 0 &&
    typeof w2.federalIncomeTaxWithheld === 'number' && !Number.isNaN(w2.federalIncomeTaxWithheld)
  ) {
    if (w2.federalIncomeTaxWithheld > w2.wages) {
      errors.push(
        `Federal income tax withheld ($${w2.federalIncomeTaxWithheld.toFixed(2)}) exceeds wages ($${w2.wages.toFixed(2)}).`,
      );
    }
    // Withholding above 50% is unusual but legal — warn, don't block.
    if (w2.federalIncomeTaxWithheld > w2.wages * 0.5) {
      warnings.push(
        `Federal withholding is more than 50% of wages — this is unusual for a ~$40k earner.`,
      );
    }
  }

  // --- stateIncomeTaxWithheld (optional) ---
  if (w2.stateIncomeTaxWithheld !== undefined) {
    if (typeof w2.stateIncomeTaxWithheld !== 'number' || Number.isNaN(w2.stateIncomeTaxWithheld)) {
      errors.push('State income tax withheld (Box 17) must be a number if provided.');
    } else if (w2.stateIncomeTaxWithheld < 0) {
      errors.push('State income tax withheld (Box 17) cannot be negative.');
    }
  }

  const ok = errors.length === 0;

  trace?.record(ok ? 'tool_result' : 'guardrail', ok ? 'validateW2: passed' : 'validateW2: failed', {
    ok,
    errorCount: errors.length,
    warningCount: warnings.length,
  });

  return { ok, errors, warnings };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract a name from a line like "Employee: Elizabeth A Darling, 2001 Campus Drive..."
 * Strips trailing address parts (text after the first comma that precedes a digit).
 */
function extractName(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  if (!match || !match[1]) return null;

  let raw = match[1].trim();
  // Strip trailing address: everything from the first comma that is followed
  // by a digit (e.g. ", 4200 Fifth Avenue") is treated as address.
  const addrIdx = raw.search(/,\s*\d/);
  if (addrIdx !== -1) {
    raw = raw.slice(0, addrIdx).trim();
  }
  return raw.length > 0 ? raw : null;
}

/**
 * Extract a dollar amount from a line like "Box 1 Wages, tips, other comp: 44629.35".
 * Handles commas, optional dollar signs, and surrounding whitespace.
 */
function extractBoxAmount(text: string, box: number): number | null {
  // Match the box number followed by any text, a colon, and then the amount.
  const pattern = new RegExp(`Box\\s*${box}\\b[^:\\n]*:\\s*([$]?[\\d,.]+)`, 'i');
  const match = text.match(pattern);
  if (!match || !match[1]) return null;

  const raw = match[1].replace(/[$,]/g, '').trim();
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}