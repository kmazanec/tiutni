/**
 * The 2025 federal tax engine. Pure, deterministic, fully unit-tested — this is
 * the part of the harness that MUST be correct, so it is plain arithmetic with
 * no LLM in the loop. Given a ReturnInput, it produces the Form1040 line values.
 *
 * NOTE (scaffold stub): the real bracket/deduction/credit tables and the
 * computation are delivered by the corellia fan-out into this file. This stub
 * exists only so the scaffold typechecks and runs; it is intentionally wrong/
 * incomplete and is replaced by the factory build.
 */

import type { ReturnInput, Form1040 } from '../domain/types.js';

export function computeReturn(_input: ReturnInput): Form1040 {
  throw new Error('tax engine not yet built — pending corellia fan-out');
}
