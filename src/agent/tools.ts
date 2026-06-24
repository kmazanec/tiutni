/**
 * The agent's TOOLS (Pillar 2): defined actions the LLM can take, each with a
 * JSON schema (what the model is allowed to call) and a code executor that
 * validates inputs and performs the real action. The LLM decides WHEN to call a
 * tool; the code decides WHAT actually happens — so tax math and PDF generation
 * are never the LLM's job, only its triggers.
 *
 * Validation in the executors IS a guardrail (Pillar 3): a filing status the
 * model invents, an out-of-range dependent count, or a malformed W-2 is rejected
 * here, before it can reach the engine.
 */

import type { Session } from '../server/sessions.js';
import type { FilingStatus, W2 } from '../domain/types.js';
import type { ToolSchema } from './llm.js';
import { parseW2, validateW2 } from '../tax/w2.js';
import { computeReturn } from '../tax/engine.js';
import { SAMPLE_W2 } from '../fixtures/sample-w2.js';

const FILING_STATUSES: FilingStatus[] = [
  'single',
  'married_filing_jointly',
  'married_filing_separately',
  'head_of_household',
];

/** The result of executing a tool: a string the LLM sees as the tool's output. */
export interface ToolResult {
  ok: boolean;
  /** Message fed back to the LLM as the tool result. */
  message: string;
}

/** The schemas advertised to the LLM. */
export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    type: 'function',
    function: {
      name: 'use_sample_w2',
      description:
        "Load the built-in realistic sample W-2 (for a ~$40k earner). Call this when the user asks to use the sample/example/test W-2 instead of providing their own.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'parse_w2_text',
      description:
        'Parse a W-2 from text the user pasted into the chat. Pass the raw pasted text. Returns the extracted wages and withholding, or an error if it could not be read.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The raw W-2 text the user pasted.' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_filing_status',
      description:
        "Record the taxpayer's filing status once the user has told you. Only call when you are confident which status they mean.",
      parameters: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: FILING_STATUSES,
            description: 'The filing status.',
          },
        },
        required: ['status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_dependents',
      description:
        'Record how many dependents the taxpayer is claiming (0 if none). Call once the user has answered.',
      parameters: {
        type: 'object',
        properties: {
          count: { type: 'integer', minimum: 0, maximum: 20, description: 'Number of dependents.' },
        },
        required: ['count'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'compute_and_finalize_return',
      description:
        'Compute the 2025 Form 1040 and prepare the downloadable PDF. Call this ONLY when you have a valid W-2 AND a filing status AND the dependent count. After this succeeds, tell the user their result (refund or amount owed) and that they can download the form.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

/**
 * Execute a tool call by name against the session. Pure side-effects live here
 * (updating session slots, computing the return). Returns a message the LLM sees.
 */
export function executeTool(session: Session, name: string, args: Record<string, unknown>): ToolResult {
  switch (name) {
    case 'use_sample_w2':
      return acceptW2(session, SAMPLE_W2, 'sample');

    case 'parse_w2_text': {
      const text = typeof args.text === 'string' ? args.text : '';
      if (!text.trim()) return fail(session, 'parse_w2_text', 'No W-2 text was provided.');
      const w2 = parseW2(text, session.trace);
      if (!w2) {
        session.trace.record('guardrail', 'parse_w2_text: could not parse pasted text');
        return { ok: false, message: 'Could not read a W-2 from that text. Ask the user to paste it with box numbers, upload the PDF, or use the sample.' };
      }
      return acceptW2(session, w2, 'pasted');
    }

    case 'set_filing_status': {
      const status = args.status;
      if (typeof status !== 'string' || !FILING_STATUSES.includes(status as FilingStatus)) {
        return fail(session, 'set_filing_status', `Invalid filing status "${String(status)}". Must be one of: ${FILING_STATUSES.join(', ')}.`);
      }
      session.profile.filingStatus = status as FilingStatus;
      session.trace.record('fact_captured', 'filing status', { filingStatus: status });
      return { ok: true, message: `Filing status recorded: ${status}.` };
    }

    case 'set_dependents': {
      const n = Number(args.count);
      if (!Number.isInteger(n) || n < 0 || n > 20) {
        return fail(session, 'set_dependents', `Invalid dependent count "${String(args.count)}". Must be a whole number 0–20.`);
      }
      session.profile.dependents = n;
      session.trace.record('fact_captured', 'dependents', { dependents: n });
      return { ok: true, message: `Dependents recorded: ${n}.` };
    }

    case 'compute_and_finalize_return':
      return finalize(session);

    default:
      session.trace.record('guardrail', `unknown tool call: ${name}`);
      return { ok: false, message: `Unknown tool "${name}".` };
  }
}

// ── shared executors ─────────────────────────────────────────────────────────

function acceptW2(session: Session, w2: W2, source: string): ToolResult {
  const validation = validateW2(w2, session.trace);
  if (!validation.ok) {
    session.trace.record('guardrail', 'W-2 failed validation', { errors: validation.errors });
    return { ok: false, message: `That W-2 has a problem: ${validation.errors.join(' ')} Ask the user to correct it.` };
  }
  session.w2 = w2;
  session.trace.record('fact_captured', `W-2 accepted (${source})`, { wages: w2.wages, employee: w2.employeeName });
  const warn = validation.warnings.length ? ` Note: ${validation.warnings.join(' ')}` : '';
  return {
    ok: true,
    message: `W-2 accepted: ${w2.employeeName}, wages $${Math.round(w2.wages).toLocaleString('en-US')}, federal withholding $${Math.round(w2.federalIncomeTaxWithheld).toLocaleString('en-US')}.${warn}`,
  };
}

function finalize(session: Session): ToolResult {
  const w2 = session.w2;
  const filingStatus = session.profile.filingStatus;
  const dependents = session.profile.dependents;
  const missing: string[] = [];
  if (!w2) missing.push('a W-2');
  if (!filingStatus) missing.push('filing status');
  if (dependents === undefined) missing.push('dependent count');
  if (!w2 || !filingStatus || dependents === undefined) {
    session.trace.record('guardrail', 'compute blocked: missing inputs', { missing });
    return { ok: false, message: `Cannot compute yet — still missing: ${missing.join(', ')}. Ask the user for what's missing.` };
  }

  session.trace.record('tool_call', 'computeReturn', { filingStatus, dependents });
  const form = computeReturn({ w2, profile: { filingStatus, dependents } });
  session.trace.record('computation', 'Form 1040 computed', {
    taxableIncome: form.taxableIncome,
    totalTax: form.totalTax,
    refund: form.refund,
    amountOwed: form.amountOwed,
  });
  session.form1040 = form;
  session.completed = true;

  const outcome =
    form.refund > 0
      ? `refund of $${form.refund.toLocaleString('en-US')}`
      : `amount owed of $${form.amountOwed.toLocaleString('en-US')}`;
  return {
    ok: true,
    message: `Return computed. Taxable income $${form.taxableIncome.toLocaleString('en-US')}, total tax $${form.totalTax.toLocaleString('en-US')}, ${outcome}. The downloadable 1040 PDF is ready. Tell the user the result warmly and that they can download it now.`,
  };
}

function fail(session: Session, tool: string, message: string): ToolResult {
  session.trace.record('guardrail', `${tool} rejected input`, { message });
  return { ok: false, message };
}
