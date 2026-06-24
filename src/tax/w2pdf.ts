/**
 * W-2 PDF ingestion. Extracts the text layer from an uploaded W-2 PDF and turns
 * it into the W2 domain shape — the bridge between a real uploaded file and the
 * existing parser/validator in w2.ts.
 *
 * The sample W-2 PDF has a real (selectable) text layer, but pdf-parse returns
 * it in a tricky order: the employee name and employer are on their own lines,
 * but the box-1 wages and box-2 federal-withheld values come out CONCATENATED
 * with no delimiter (e.g. the token "44629.357631.62" = 44629.35 then 7631.62),
 * and the box LABELS sit on entirely different lines from the values. So a naive
 * "Box 1: <amount>" regex won't work; the extractor is layout-tolerant.
 */

import { createRequire } from 'node:module';
import type { W2 } from '../domain/types.js';
import type { Trace } from '../observe/trace.js';

// pdf-parse's package entry runs debug code at import time that reads a missing
// test file and throws. Import the inner module directly to avoid that footgun.
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (
  data: Buffer,
) => Promise<{ text: string; numpages: number }>;

/** A currency value like 44629.35 (exactly two decimals). */
const CURRENCY = /\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2}/g;

export async function parseW2Pdf(pdfBytes: Uint8Array, trace?: Trace): Promise<W2 | null> {
  trace?.record('tool_call', 'parseW2Pdf: extracting text from uploaded PDF');

  let text: string;
  try {
    const data = await pdfParse(Buffer.from(pdfBytes));
    text = data.text ?? '';
  } catch (err) {
    trace?.record('guardrail', 'parseW2Pdf: PDF text extraction failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }

  if (!text.trim()) {
    trace?.record('guardrail', 'parseW2Pdf: no text layer found (image-only scan?)');
    return null;
  }

  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const employeeName = findEmployeeName(lines);
  const employerName = findEmployerName(lines);
  const amounts = findWagesAndWithholding(lines);

  if (!employeeName || !employerName || !amounts) {
    trace?.record('guardrail', 'parseW2Pdf: could not recover all required W-2 fields', {
      hasEmployeeName: Boolean(employeeName),
      hasEmployerName: Boolean(employerName),
      hasAmounts: Boolean(amounts),
    });
    return null;
  }

  const w2: W2 = {
    employeeName,
    employerName,
    wages: amounts.wages,
    federalIncomeTaxWithheld: amounts.withholding,
    ...(amounts.stateTax !== undefined ? { stateIncomeTaxWithheld: amounts.stateTax } : {}),
  };

  trace?.record('tool_result', 'parseW2Pdf: extracted W-2 from PDF', {
    employeeName,
    employerName,
    wages: w2.wages,
    federalIncomeTaxWithheld: w2.federalIncomeTaxWithheld,
  });
  return w2;
}

// ── extraction helpers ───────────────────────────────────────────────────────

/** Title-case a SHOUTED name ("ELIZABETH A DARLING" → "Elizabeth A Darling"). */
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (_, c: string) => c.toUpperCase())
    .trim();
}

/**
 * The employee name line. On the sample it is an all-caps personal name with no
 * digits and no employer/keyword noise, e.g. "ELIZABETH A DARLING". We take the
 * first such line that looks like a person (2–4 words, mostly letters) and is
 * not the employer.
 */
function findEmployeeName(lines: string[]): string | null {
  // Prefer a line explicitly labeled, if present.
  for (const l of lines) {
    const m = l.match(/Employee'?s?\s*name[^:]*:\s*(.+)/i);
    if (m && m[1]) return cleanName(m[1]);
  }
  // Otherwise: an all-caps name-shaped line that isn't the employer.
  for (const l of lines) {
    if (/\d/.test(l)) continue;
    if (/UNIVERSITY|COMPANY|INC|LLC|CORP|DEPARTMENT|ADDRESS|STATEMENT|WAGE|TAX|COPY|EARNINGS/i.test(l)) continue;
    const words = l.split(' ');
    if (words.length >= 2 && words.length <= 4 && /^[A-Z][A-Z.\- ]+$/.test(l)) {
      return titleCase(l);
    }
  }
  return null;
}

// Words that mark a line as box-label/header noise rather than an org name.
const EMPLOYER_NOISE = /CONTROL|NUMBER|DEPT|CORP\.|USE ONLY|BOX|WAGE|STATEMENT|OMB|COPY|FED ID|EIN/i;
// Words that positively indicate an organization name.
const ORG_HINT = /UNIVERSITY|COLLEGE|COMPANY|\bINC\b|\bLLC\b|\bCORP\b|HOSPITAL|SCHOOL|SERVICES|SYSTEMS|GROUP|ASSOCIATES|FOUNDATION|INSTITUTE/i;

function findEmployerName(lines: string[]): string | null {
  for (const l of lines) {
    const m = l.match(/Employer'?s?\s*name[^:]*:\s*(.+)/i);
    if (m && m[1]) return cleanName(m[1]);
  }
  // A clean all-caps org-name line (e.g. "UNIVERSITY OF PITTSBURGH"): contains an
  // org hint, no digits, and none of the box-label noise words.
  for (const l of lines) {
    if (/\d/.test(l) || EMPLOYER_NOISE.test(l)) continue;
    if (ORG_HINT.test(l) && /^[A-Z][A-Z.&'\- ]+$/.test(l)) {
      return titleCase(l);
    }
  }
  return null;
}

function cleanName(raw: string): string {
  // Strip trailing address (first comma followed by a digit).
  const addrIdx = raw.search(/,\s*\d/);
  const trimmed = (addrIdx !== -1 ? raw.slice(0, addrIdx) : raw).trim();
  return /[a-z]/.test(trimmed) ? trimmed : titleCase(trimmed);
}

/**
 * Find box-1 wages and box-2 federal withholding. The two values appear together
 * — sometimes concatenated with no separator ("44629.357631.62"), sometimes
 * space/newline separated. Strategy: scan every line for currency tokens; the
 * first line that yields at least two currency values whose first value is a
 * plausible wage is taken as (wages, withholding). Optionally capture state tax.
 */
function findWagesAndWithholding(
  lines: string[],
): { wages: number; withholding: number; stateTax?: number } | null {
  for (const line of lines) {
    const nums = extractCurrencies(line);
    if (nums.length >= 2) {
      const [wages, withholding] = nums;
      if (wages !== undefined && withholding !== undefined && wages > 0 && withholding >= 0 && withholding <= wages) {
        const result: { wages: number; withholding: number; stateTax?: number } = { wages, withholding };
        if (nums.length >= 3 && nums[2] !== undefined) result.stateTax = nums[2];
        return result;
      }
    }
  }
  return null;
}

/**
 * Pull currency values out of a line, splitting concatenated runs. A token like
 * "44629.357631.62" is two values (44629.35, 7631.62): every match of the
 * two-decimal currency pattern is a separate value even with no delimiter.
 */
function extractCurrencies(line: string): number[] {
  const out: number[] = [];
  const matches = line.match(CURRENCY);
  if (!matches) return out;
  for (const m of matches) {
    const n = Number(m.replace(/,/g, ''));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}
