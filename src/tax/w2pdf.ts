/**
 * W-2 PDF ingestion. Extracts the text layer from an uploaded W-2 PDF and turns
 * it into the W2 domain shape. This is the bridge between a real uploaded file
 * and the existing text-based parser/validator in w2.ts.
 *
 * The sample W-2 PDF has a real (selectable) text layer, but its box LABELS and
 * box VALUES sit on separate lines/columns — "1 Wages, tips, other comp." on one
 * line and "44629.35  7631.62" on another — so a naive "Box 1: amount" match
 * won't find them. The extractor must be layout-tolerant.
 *
 * NOTE (scaffold stub): the real PDF text extraction + layout-tolerant field
 * mapping is delivered by the corellia fan-out. This stub keeps the scaffold
 * compiling and defines the contract.
 */

import type { W2 } from '../domain/types.js';
import type { Trace } from '../observe/trace.js';

/**
 * Parse a W-2 from the raw bytes of an uploaded PDF. Returns null when no W-2
 * can be recovered from the document (not a W-2, image-only scan with no text
 * layer, etc.). The caller then asks the user to paste the figures instead.
 */
export async function parseW2Pdf(_pdfBytes: Uint8Array, _trace?: Trace): Promise<W2 | null> {
  throw new Error('W-2 PDF extractor not yet built — pending corellia fan-out');
}
