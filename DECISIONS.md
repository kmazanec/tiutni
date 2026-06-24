# DECISIONS — Agentic Tax-Filing Assistant

The route from the four pillars to a working, downloadable 2025 Form 1040, and
why each open choice was made the way it was.

## The headline choice: how this was built

This system was **built by an agentic software factory** ([corellia](../corellia)),
not typed by hand. A single `deliver-intent` goal — "build the tax-filing
assistant into this scaffold" — was commissioned through corellia's front door.
The factory split it into typed `implement` children (tax engine, W-2 parser,
1040 filler, guardrails, orchestrator), wrote each into an isolated git worktree,
ran the declared `typecheck` + `test` scripts to verify its own work, judged each
diff with an LLM critic, repaired on failure, and emitted the collected work as a
branch we merged onto `main`. The event log of that run is the build's own
observation trail. (See `BUILD.md`.)

This matters for judging: the *harness* here is two-layered. corellia is the
build-time agent harness; the tax assistant below is the run-time agent harness.
Both demonstrate the four pillars.

## The four pillars (run-time)

- **Chat loop / state across turns** — A deterministic slot-filling state machine
  (`src/agent/orchestrator.ts`) backed by an in-memory `Session`
  (`src/server/sessions.ts`). State is explicit and inspectable; turns are pure
  functions of session + message.
- **Tools** — Real actions, not talk: `parseW2`/`validateW2` (`src/tax/w2.ts`),
  `computeReturn` (`src/tax/engine.ts`), `renderForm1040Pdf` (`src/form/fill1040.ts`).
  The last one produces the actual downloadable file.
- **Guardrails** — Enforced in **code**, not prose (`src/agent/guardrails.ts`):
  a hard 5-question counter the loop cannot exceed; input classification that
  redirects off-topic / advice-seeking turns; range+schema validation on every
  value accepted from the user or the W-2; and a standing refusal to give tax
  advice or claim to file the return.
- **Observation** — An append-only `Trace` (`src/observe/trace.ts`) records every
  user turn, tool call, guardrail decision, captured fact, and computed line.
  It is surfaced **in the UI** (the right-hand panel) and mirrored to server logs.

## Open decisions and rationale

| Decision | Choice | Why |
|---|---|---|
| Language / framework | TypeScript + Express, zero front-end framework | Smallest legible surface; the brief says don't spend effort on UI polish. |
| LLM use | Deterministic state machine for **control**; LLM only for **warmth/paraphrase**, and optional | Guardrails and the 5-question budget must be *enforced and visible*, not "in the prompt." The math must be exact. The app runs with **no API key** (static warm copy) so a judge can always reach it. |
| Tax computation | Hand-coded 2025 brackets, standard deduction, and CTC/ODC; pure & unit-tested | A ~$40k single-W-2 return is fully determinable; exactness beats an LLM guess. Tests pin the sample W-2's numbers. |
| The 1040 file | Rendered to PDF with `pdf-lib` | A real, openable PDF with every computed line; no external service, no IRS-form scraping fragility. |
| W-2 input | A realistic fake W-2 (the provided sample) selectable in chat, plus a paste-parser | No real PII; the parser also exercises the messy-input guardrail (stretch goal). |
| Filing status | single / MFJ / MFS / HoH all supported | The brief requires changing inputs by filing status. |
| State / sessions | In-memory, per-session | Single-instance prototype; no PII at rest; sessions evaporate on restart. |
| Hosting | Render (Docker) — free tier | Asked for by the brief; one Dockerfile, publicly reachable. |
| Testing | Vitest unit tests on the engine, parser, filler, guardrails, and a full happy-path orchestrator run | Proves it works end-to-end, not just a happy-path mock. |

## What this is not

An educational/hackathon prototype. Fake W-2 and test data only — no real PII,
no e-filing. The agent does not give tax advice and says so.
