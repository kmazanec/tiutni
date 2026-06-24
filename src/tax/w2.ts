/**
 * W-2 ingestion + validation (Pillar 3 guardrails on input). Parses a W-2 from
 * either structured JSON or pasted text, and validates the parsed result before
 * the engine is allowed to trust it.
 *
 * NOTE (scaffold stub): the real parser + validator are delivered by the
 * corellia fan-out. These stubs keep the scaffold compiling and define the
 * contract the factory builds against.
 */

import type { W2, ValidationResult } from '../domain/types.js';

export function parseW2(_raw: string): W2 | null {
  throw new Error('W-2 parser not yet built — pending corellia fan-out');
}

export function validateW2(_w2: W2): ValidationResult {
  throw new Error('W-2 validator not yet built — pending corellia fan-out');
}
