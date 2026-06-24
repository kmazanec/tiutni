import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { parseW2Pdf } from '../src/tax/w2pdf.js';

const here = dirname(fileURLToPath(import.meta.url));
const samplePath = join(here, '..', 'public', 'sample-w2.pdf');

describe('parseW2Pdf — official sample W-2 PDF', () => {
  it('extracts wages, withholding, and names from the real sample PDF', async () => {
    const bytes = new Uint8Array(await readFile(samplePath));
    const w2 = await parseW2Pdf(bytes);
    expect(w2).not.toBeNull();
    expect(w2?.wages).toBe(44629.35);
    expect(w2?.federalIncomeTaxWithheld).toBe(7631.62);
    expect(w2?.employeeName?.toLowerCase()).toContain('darling');
    expect(w2?.employerName?.toLowerCase()).toContain('pittsburgh');
  });

  it('returns null for a PDF that is not a W-2', async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([300, 200]);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    page.drawText('hello, this is not a tax form', { x: 20, y: 100, size: 12, font });
    const bytes = await doc.save();
    const w2 = await parseW2Pdf(bytes);
    expect(w2).toBeNull();
  });

  it('returns null for empty / garbage bytes without throwing', async () => {
    const w2 = await parseW2Pdf(new Uint8Array([1, 2, 3, 4]));
    expect(w2).toBeNull();
  });
});
