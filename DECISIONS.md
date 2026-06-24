# DECISIONS — Agentic Tax-Filing Assistant

The route from the four pillars to a working, downloadable 2025 Form 1040, and
why each open choice was made the way it was.

## The headline choice: how this was built

Much of this system was **built by an agentic software factory**
([corellia](../corellia)), not typed by hand. A `deliver-intent` goal was
commissioned through corellia's front door; the factory split it into typed
`implement` children, wrote each into an isolated git worktree, ran the declared
`typecheck` + `test` scripts to verify its own work, judged each diff with an LLM
critic, and emitted the collected work as a branch merged onto `main`. The tax
engine, W-2 parser, and guardrails came from that run; where the factory blocked,
the stuck part was hand-built the same way (see `BUILD.md`).

This matters for judging: the *harness* here is two-layered. corellia is the
build-time agent harness; the tax assistant below is the run-time agent harness —
a real LLM tool-calling agent (`src/agent/agent.ts`). Both demonstrate the four
pillars.

## The four pillars (run-time)

- **Chat loop / state across turns** — A **real LLM agent loop** (`src/agent/agent.ts`),
  not a hardcoded state machine. Each turn, the LLM (via OpenRouter) reads the
  transcript carried on the in-memory `Session` (`src/server/sessions.ts`),
  decides what to say, and **calls tools** to act. The agent *reasons* about the
  conversation — it understands "I got married last year" without a regex for it.
- **Tools** — Real actions the LLM triggers (`src/agent/tools.ts`): `use_sample_w2`,
  `parse_w2_text`, `set_filing_status`, `set_dependents`, and
  `compute_and_finalize_return`. Each has a JSON schema (what the model may call)
  and a code executor that does the real work — `computeReturn` (`src/tax/engine.ts`)
  and `renderForm1040Pdf` (`src/form/fill1040.ts`, the actual IRS form). The LLM
  never does tax math or writes the PDF; it only triggers the deterministic tools.
- **Guardrails** — Code-enforced rails **around** the LLM, not prompt-only:
  (a) the 5-question budget is a hard counter the harness tracks — once spent, the
  system note tells the model it has *no* questions left and to finalize, so it
  cannot extract a sixth answer; (b) every tool input is validated in the executor
  (`src/agent/tools.ts`) before it reaches the engine — a bogus filing status or a
  premature `compute` is rejected at the boundary; (c) advice/off-topic input is
  classified and redirected (`src/agent/guardrails.ts`) *before* an LLM turn runs.
- **Observation** — An append-only `Trace` (`src/observe/trace.ts`) records every
  LLM decision, **tool call + arguments**, tool result, guardrail decision, and
  computed line — a genuine agent-decision log. Surfaced **in the UI** panel and
  mirrored to logs.

## Open decisions and rationale

| Decision | Choice | Why |
|---|---|---|
| Language / framework | TypeScript + Express, zero front-end framework | Smallest legible surface; the brief says don't spend effort on UI polish. |
| LLM use | **The LLM drives the conversation** via tool-calling (OpenRouter); code enforces the rails. **Requires** an API key — no static fallback | The brief's top criterion is harness quality: the chat loop must be a *real* agent, not a scripted FSM. So the LLM owns cognition (understanding intent, deciding what to ask, when to call which tool) while code owns the rails (5-question cap, input validation, no-advice, all tax math + PDF). Model: OpenRouter (`deepseek/deepseek-v4-pro` by default, overridable via `TIUTNI_MODEL`) — chosen to match the corellia toolchain; its tool-calling proved reliable for this flow. |
| Tax computation | Hand-coded 2025 brackets, standard deduction, and CTC/ODC; pure & unit-tested | A ~$40k single-W-2 return is fully determinable; exactness beats an LLM guess. Tests pin the sample W-2's numbers. |
| The 1040 file | Fills the **actual official IRS 2025 Form 1040** (vendored `src/assets/f1040-2025.pdf`) via its AcroForm fields, then flattens | The download is the genuine IRS document, not a facsimile. Field→line map verified by rendering. Falls back to a self-drawn facsimile only if the template can't load. |
| W-2 input | Three ways: **upload the W-2 PDF**, paste the text, or use the built-in sample | PDF upload extracts the text layer with `pdf-parse` (layout-tolerant — the real form concatenates the box-1/box-2 values). A "Try the sample PDF" button uploads the bundled sample so a judge can test upload in-browser. No real PII. |
| Filing status | single / MFJ / MFS / HoH all supported | The brief requires changing inputs by filing status. |
| State / sessions | In-memory, per-session | Single-instance prototype; no PII at rest; sessions evaporate on restart. |
| Hosting | Render (Docker) — free tier | Asked for by the brief; one Dockerfile, publicly reachable. |
| Testing | Vitest: deterministic tools (engine, parser, filler, guardrails) unit-tested; the **agent loop tested against a stubbed LLM** (scripted tool-call sequences) so it's deterministic and needs no key | Proves the agent's control flow + rails end-to-end without depending on a live model — the rigorous way to test an agent. |

## What this is not

An educational/hackathon prototype. Fake W-2 and test data only — no real PII,
no e-filing. The agent does not give tax advice and says so.
