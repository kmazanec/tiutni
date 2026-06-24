/**
 * Renders a completed 2025 Form 1040 as a downloadable PDF from the computed
 * Form1040 line values.
 *
 * NOTE (scaffold stub): the real implementation — acquiring the IRS 1040 PDF and
 * stamping field values onto it, or drawing a faithful facsimile with pdf-lib —
 * is delivered by the corellia fan-out. This stub keeps the scaffold compiling.
 */

import type { Form1040 } from '../domain/types.js';

export async function renderForm1040Pdf(_form: Form1040): Promise<Uint8Array> {
  throw new Error('1040 PDF filler not yet built — pending corellia fan-out');
}
