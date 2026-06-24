/**
 * Renders a completed 2025 Form 1040 by filling the ACTUAL official IRS form.
 *
 * The official 2025 Form 1040 (downloaded from irs.gov, vendored at
 * src/assets/f1040-2025.pdf) is a real fillable AcroForm. We map our computed
 * Form1040 line values onto its form fields and flatten the result, so the
 * download a user gets is the genuine IRS document with their numbers in it —
 * not a facsimile.
 *
 * The IRS form is an XFA/AcroForm hybrid with opaque positional field names
 * (e.g. `topmostSubform[0].Page1[0].f1_47[0]` is line 1a). The mapping in
 * FIELD_MAP was derived and verified by filling the form and visually
 * confirming every value lands on the correct line (single filer, sample W-2:
 * 1a/9/11=44,629, 12=15,750, 15=28,879, 16=3,227, 24=3,227, 25a=7,632, 34/35a
 * refund=4,405). pdf-lib drops the unsupported XFA layer (harmless for our
 * flat-fill use).
 *
 * If the template can't be loaded for any reason, we fall back to a clean
 * self-contained facsimile so the app always produces a downloadable 1040.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Form1040, FilingStatus } from '../domain/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// The asset sits next to this module's source. It is copied alongside dist at
// build time (see scripts/copy-assets and the Dockerfile).
const TEMPLATE_PATH = join(__dirname, '..', 'assets', 'f1040-2025.pdf');

const P1 = 'topmostSubform[0].Page1[0].';
const P2 = 'topmostSubform[0].Page2[0].';

/** Text-field map: 1040 line/box → AcroForm field name. Verified by render. */
const TEXT_FIELDS = {
  firstName: P1 + 'f1_14[0]',
  lastName: P1 + 'f1_15[0]',
  line1a_wages: P1 + 'f1_47[0]',
  line1z: P1 + 'f1_57[0]',
  line9_totalIncome: P1 + 'f1_73[0]',
  line11_agi_p1: P1 + 'f1_75[0]',
  line11b_agi_p2: P2 + 'f2_01[0]',
  line12_stdDeduction: P2 + 'f2_02[0]',
  line14: P2 + 'f2_05[0]',
  line15_taxableIncome: P2 + 'f2_06[0]',
  line16_tax: P2 + 'f2_08[0]',
  line19_dependentCredit: P2 + 'f2_11[0]',
  line22_taxAfterCredits: P2 + 'f2_14[0]',
  line24_totalTax: P2 + 'f2_16[0]',
  line25a_withholding: P2 + 'f2_17[0]',
  line25d: P2 + 'f2_20[0]',
  line33_totalPayments: P2 + 'f2_29[0]',
  line34_overpayment: P2 + 'f2_30[0]',
  line35a_refund: P2 + 'f2_31[0]',
  line37_amountOwed: P2 + 'f2_35[0]',
} as const;

/** Filing-status checkbox field names (verified by render). One is checked. */
const FILING_STATUS_CHECKBOX: Record<FilingStatus, string> = {
  single: P1 + 'Checkbox_ReadOrder[0].c1_8[0]',
  married_filing_jointly: P1 + 'Checkbox_ReadOrder[0].c1_8[1]',
  married_filing_separately: P1 + 'Checkbox_ReadOrder[0].c1_8[2]',
  head_of_household: P1 + 'c1_8[0]',
};

const FILING_STATUS_LABEL: Record<FilingStatus, string> = {
  single: 'Single',
  married_filing_jointly: 'Married filing jointly',
  married_filing_separately: 'Married filing separately',
  head_of_household: 'Head of household',
};

/** Whole-dollar amount with thousands separators (e.g. 29629 -> "29,629"). */
function money(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** Split a full name into "First Middle" and "Last" for the two name fields. */
function splitName(full: string): { first: string; last: string } {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0] ?? '', last: '' };
  const last = parts[parts.length - 1] ?? '';
  const first = parts.slice(0, -1).join(' ');
  return { first, last };
}

export async function renderForm1040Pdf(form: Form1040): Promise<Uint8Array> {
  try {
    return await fillOfficialForm(form);
  } catch {
    // Asset missing or unfillable in this environment — never fail the download.
    return renderFacsimile(form);
  }
}

async function fillOfficialForm(form: Form1040): Promise<Uint8Array> {
  const bytes = await readFile(TEMPLATE_PATH);
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const acro = pdf.getForm();

  const { first, last } = splitName(form.taxpayerName);

  const values: Record<string, string> = {
    [TEXT_FIELDS.firstName]: first,
    [TEXT_FIELDS.lastName]: last,
    [TEXT_FIELDS.line1a_wages]: money(form.wages),
    [TEXT_FIELDS.line1z]: money(form.wages),
    [TEXT_FIELDS.line9_totalIncome]: money(form.totalIncome),
    [TEXT_FIELDS.line11_agi_p1]: money(form.adjustedGrossIncome),
    [TEXT_FIELDS.line11b_agi_p2]: money(form.adjustedGrossIncome),
    [TEXT_FIELDS.line12_stdDeduction]: money(form.standardDeduction),
    [TEXT_FIELDS.line14]: money(form.standardDeduction),
    [TEXT_FIELDS.line15_taxableIncome]: money(form.taxableIncome),
    [TEXT_FIELDS.line16_tax]: money(form.tax),
    [TEXT_FIELDS.line19_dependentCredit]: money(form.dependentCredit),
    [TEXT_FIELDS.line22_taxAfterCredits]: money(form.taxAfterCredits),
    [TEXT_FIELDS.line24_totalTax]: money(form.totalTax),
    [TEXT_FIELDS.line25a_withholding]: money(form.withholding),
    [TEXT_FIELDS.line25d]: money(form.withholding),
    [TEXT_FIELDS.line33_totalPayments]: money(form.totalPayments),
    [TEXT_FIELDS.line34_overpayment]: money(form.refund),
    [TEXT_FIELDS.line35a_refund]: money(form.refund),
    [TEXT_FIELDS.line37_amountOwed]: money(form.amountOwed),
  };

  for (const [name, value] of Object.entries(values)) {
    try {
      acro.getTextField(name).setText(value);
    } catch {
      // A field name that drifted in a future revision is skipped, not fatal.
    }
  }

  try {
    acro.getCheckBox(FILING_STATUS_CHECKBOX[form.filingStatus]).check();
  } catch {
    /* checkbox name drift — skip */
  }

  // Flatten so the values are baked into the page content (not editable form
  // fields) — the download reads as a completed return.
  acro.flatten();
  return pdf.save();
}

// ── Fallback facsimile (only if the official template can't be loaded) ────────

async function renderFacsimile(form: Form1040): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle('2025 Form 1040 — U.S. Individual Income Tax Return');
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.1, 0.12);
  const muted = rgb(0.45, 0.45, 0.5);
  const left = 54;
  const right = 558;
  let y = 740;
  const text = (s: string, x: number, yy: number, f: PDFFont, size: number, color = ink) =>
    page.drawText(s, { x, y: yy, size, font: f, color });

  text('Form 1040', left, y, bold, 20);
  text('2025', right - 48, y, bold, 20);
  y -= 18;
  text('U.S. Individual Income Tax Return', left, y, font, 11, muted);
  y -= 24;
  text('Name', left, y, bold, 9, muted);
  text(form.taxpayerName, left + 90, y, font, 11);
  y -= 20;
  text('Filing status', left, y, bold, 9, muted);
  text(FILING_STATUS_LABEL[form.filingStatus], left + 90, y, font, 11);
  y -= 24;

  const line = (num: string, label: string, amount: number) => {
    text(num, left, y, bold, 10, muted);
    text(label, left + 34, y, font, 10);
    const s = `$${money(amount)}`;
    text(s, right - font.widthOfTextAtSize(s, 10), y, font, 10);
    y -= 19;
  };
  line('1a', 'Wages (W-2 box 1)', form.wages);
  line('9', 'Total income', form.totalIncome);
  line('11', 'Adjusted gross income', form.adjustedGrossIncome);
  line('12', 'Standard deduction', form.standardDeduction);
  line('15', 'Taxable income', form.taxableIncome);
  line('16', 'Tax', form.tax);
  line('24', 'Total tax', form.totalTax);
  line('25a', 'Federal withholding', form.withholding);
  line('33', 'Total payments', form.totalPayments);
  line('34', 'Refund', form.refund);
  line('37', 'Amount owed', form.amountOwed);

  text('Fallback render (official IRS template unavailable). Educational/test use only — not filed.', left, 60, font, 8, muted);
  return pdf.save();
}
