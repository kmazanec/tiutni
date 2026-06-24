# tiutni — Agentic Tax-Filing Assistant

Chat your way to a completed **2025 IRS Form 1040**. A user shows up with a W-2,
has a short, friendly conversation (≤ 5 questions), and downloads a finished
1040 PDF.

> Educational/hackathon prototype. Fake W-2 and test data only — **no real PII,
> no e-filing.** Not tax advice; the agent says so and won't pretend otherwise.

## Live URL

**→ https://tiutni-tax-assistant.onrender.com**

A judge can open it, click **"Try the sample PDF"** (or upload a W-2 PDF, or say
"use the sample"), answer two questions (filing status + dependents), and
download the completed return — which is the **actual official IRS 2025 Form
1040** with the figures filled in.

> Hosted on Render's free tier, which sleeps after inactivity — the **first
> request after idle takes ~30–50s to cold-start**, then it's fast.

## One-command local run

```bash
npm install && npm run dev
# open http://localhost:3000
```

No API key required — the assistant runs entirely on its deterministic engine.
(An `OPENROUTER_API_KEY` is *optional*; it only adds LLM-phrased warmth.)

To try it without the browser:

```bash
npm install && npm test     # 120 tests: engine, W-2, guardrails, orchestrator, PDF
```

## The four pillars (where to point in the code)

| Pillar | Where | What's enforced |
|---|---|---|
| **Chat loop / state** | `src/agent/orchestrator.ts`, `src/server/sessions.ts` | An explicit `phase` state machine + per-session slots carried across turns. |
| **Tools** | `src/tax/w2.ts`, `src/tax/w2pdf.ts`, `src/tax/engine.ts`, `src/form/fill1040.ts` | Real actions: parse a W-2 from pasted text **or an uploaded PDF**, validate it, compute the return, and fill the **official IRS 1040 PDF**. |
| **Guardrails** | `src/agent/guardrails.ts` | **Code-enforced:** hard 5-question counter; advice/off-topic redirect; W-2 range+schema validation; standing "no advice, not filed" refusal. |
| **Observation** | `src/observe/trace.ts` + the UI panel | Append-only per-session trace of every turn, tool call, guardrail decision, and computed line — shown live in the right-hand panel and mirrored to logs. |

## How it was built

The substantive modules were built by an **agentic software factory**
([corellia](../corellia)) — a single goal commissioned, split into typed build
tasks, written into an isolated worktree, and verified by its own tests. See
[`BUILD.md`](BUILD.md). The design rationale is in [`DECISIONS.md`](DECISIONS.md).

## Architecture (one breath)

`public/` (minimal chat UI) → `src/server/` (Express routes, in-memory sessions)
→ `src/agent/orchestrator.ts` (the chat loop) → tools in `src/tax/` + `src/form/`
→ everything records into `src/observe/trace.ts`. The domain contract that holds
it together is `src/domain/types.ts`.

## Deploy

Dockerized; `render.yaml` deploys it to Render's free tier as a Docker web
service with a `/health` check. See `DEPLOY.md`.
