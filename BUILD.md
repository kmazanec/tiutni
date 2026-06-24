# BUILD.md — how this was built by an agentic software factory

The tax engine, W-2 parser/validator, and guardrails in this repo were **not
typed by hand**. They were built by [corellia](../corellia), a recursive software
factory, commissioned through a single goal.

## The commission

A `live:tiutni` harness (`corellia/examples/live-tiutni.ts`, local-only — no PR
boundary) handed corellia one `deliver-intent` goal:

> "Build the working tax-filing assistant into this existing TypeScript/Express
> scaffold… replace the stub bodies with real, tested implementations: the 2025
> tax engine, the W-2 parser/validator, the 1040 PDF filler, the guardrails, and
> the conversation orchestrator."

with scope `src/tax/`, `src/form/`, `src/agent/`, `tests/`, declared verification
scripts (`npm run typecheck`, `npm test`), and a generous budget (80 attempts,
8M tokens).

## What the factory did (from its own event log)

The factory:

1. **Classified risk** and **split** the goal into typed `implement` children —
   one per module.
2. **Wrote each module** into an isolated git worktree under
   `.corellia/worktrees/<treeId>/` (never touching the primary checkout).
3. **Verified its own work** by running the declared `typecheck`/`test` scripts
   inside the worktree.
4. **Judged** each diff with an LLM critic (`critique-code`) and a final
   `judge-integration` pass.

**Result:** 4 of 5 build children landed; 3 modules were delivered green:

| Module | Outcome |
|---|---|
| `src/tax/engine.ts` — 2025 tax engine | ✅ delivered, **42 tests** |
| `src/tax/w2.ts` — W-2 parser + validator | ✅ delivered, **25 tests** |
| `src/agent/guardrails.ts` — classifier + budget | ✅ delivered, **44 tests** |
| `src/form/fill1040.ts` — 1040 PDF filler | ✗ failed its judge |
| `src/agent/orchestrator.ts` — chat loop | ✗ skipped (depended on the filler) |

The factory's `judge-integration` correctly **blocked** the root rather than ship
a partial integration — exactly the bounded behavior you want. Cost of the run:
**~$0.84** (792k prompt + 65k completion tokens).

The three delivered modules were merged onto `main`
(`38dbb2a`, merge `e4ae26d`) — **111 of the repo's tests came straight from the
factory.** Their quality is high: the engine's 2025 brackets match Rev. Proc.
2024-40, and it ships a test asserting the sample W-2's exact result. The
standard deduction constants were later corrected for tax year 2025, bringing
the sample result to taxable $28,879 → tax $3,227 → refund $4,405.

## The hand-off

Per the factory's own bootstrap discipline (when it stalls, record the stuck
point, then hand-build the stuck part *the same way the factory would*), the two
blocked modules — the PDF filler and the orchestrator — were completed by hand on
`main` (`345a745`), constitution-style: tested, observation-instrumented, no
contract drift. The off-topic guardrail was also made phase-aware so a user's
direct answer mid-flow isn't second-guessed.

**Net:** a two-layer harness. corellia is the *build-time* agent harness; the tax
assistant is the *run-time* agent harness. Both demonstrate the four pillars, and
the factory's event log is itself an observation trail of the build.

## Later iterations (W-2 PDF upload + real IRS form)

Two follow-on features were commissioned the same way (`live:tiutni` with focused
`TIUTNI_FEATURE`/`TIUTNI_SCOPE`):

- **W-2 PDF upload** — the factory blocked (`step-loop:failed`, ~$0.17) before
  writing durable code, so the parser + UI were hand-built. The hard part was
  discovered first by hand: `pdf-parse` must be imported via its inner module,
  and the sample form's text layer concatenates the box-1/box-2 values
  (`44629.357631.62`), so the extractor splits on the two-decimal currency
  pattern. Verified against the real sample PDF.
- **Filling the ACTUAL IRS 2025 Form 1040** — the official fillable PDF was
  downloaded from irs.gov and vendored. Its AcroForm uses opaque positional field
  names (`f1_47` = line 1a, etc.), so the field→line map was derived and
  **verified by rendering** the filled form and eyeballing every line before
  trusting it. This verification-first approach is exactly why it was hand-built
  rather than commissioned blind: a transposed field silently puts money on the
  wrong line.

The pattern holds: commission first, and where the factory stalls, record the
stuck point and hand-build the stuck part the way the factory would — tested,
observable, verified.
