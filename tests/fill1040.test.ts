import { describe, it, expect } from 'vitest';
import { renderForm1040Pdf } from '../src/form/fill1040.js';
import { computeReturn } from '../src/tax/engine.js';
import { SAMPLE_W2 } from '../src/fixtures/sample-w2.js';

describe('1040 PDF filler', () => {
  it('produces a valid, non-empty PDF for the sample return', async () => {
    const form = computeReturn({ w2: SAMPLE_W2, profile: { filingStatus: 'single', dependents: 0 } });
    const bytes = await renderForm1040Pdf(form);
    expect(bytes.length).toBeGreaterThan(1000);
    // PDF magic header is "%PDF".
    const header = Buffer.from(bytes.slice(0, 4)).toString('ascii');
    expect(header).toBe('%PDF');
  });

  it('renders for an amount-owed return too', async () => {
    const form = computeReturn({
      w2: { employeeName: 'Test Owes', employerName: 'Acme', wages: 90000, federalIncomeTaxWithheld: 200 },
      profile: { filingStatus: 'single', dependents: 0 },
    });
    expect(form.amountOwed).toBeGreaterThan(0);
    const bytes = await renderForm1040Pdf(form);
    expect(Buffer.from(bytes.slice(0, 4)).toString('ascii')).toBe('%PDF');
  });
});
