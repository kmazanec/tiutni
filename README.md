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

The conversational agent is **LLM-driven** and needs an OpenRouter key:

```bash
cp .env.example .env        # then put your OPENROUTER_API_KEY in .env
npm install && npm run dev
# open http://localhost:3000
```

Get a key at https://openrouter.ai/keys. The model defaults to
`deepseek/deepseek-v4-pro`; override with `TIUTNI_MODEL` in `.env`.

The test suite needs **no key** — the agent loop is tested against a stubbed LLM:

```bash
npm install && npm test     # 123 tests: agent loop, engine, W-2, guardrails, PDF
```

## The four pillars (where to point in the code)

| Pillar | Where | What's enforced |
|---|---|---|
| **Chat loop / state** | `src/agent/agent.ts`, `src/agent/llm.ts`, `src/server/sessions.ts` | A real **LLM tool-calling agent** — the model reasons over the transcript and calls tools; state carried per-session across turns. |
| **Tools** | `src/agent/tools.ts` (+ `src/tax/`, `src/form/`) | Real actions the LLM **calls**: load/parse a W-2, set filing status & dependents, compute the return, and fill the **official IRS 1040 PDF**. The LLM never does math or writes the PDF — it triggers the deterministic tools. |
| **Guardrails** | `src/agent/tools.ts` (validation) + `src/agent/guardrails.ts` + `src/agent/agent.ts` (budget) | **Code-enforced around the LLM:** hard 5-question counter the model can't exceed; tool-input validation at the boundary; advice/off-topic redirect before any LLM turn; "no advice, not filed" stance. |
| **Observation** | `src/observe/trace.ts` + the UI panel | Append-only per-session trace of every turn, tool call, guardrail decision, and computed line — shown live in the right-hand panel and mirrored to logs. |

## How it was built

The substantive modules were built by an **agentic software factory**
([corellia](../corellia)) — a single goal commissioned, split into typed build
tasks, written into an isolated worktree, and verified by its own tests. See
[`BUILD.md`](BUILD.md). The design rationale is in [`DECISIONS.md`](DECISIONS.md).

## Architecture (one breath)

`public/` (minimal chat UI) → `src/server/` (Express routes, in-memory sessions)
→ `src/agent/agent.ts` (the LLM tool-calling loop) → `src/agent/tools.ts` →
the deterministic tools in `src/tax/` + `src/form/` → everything records into
`src/observe/trace.ts`. The domain contract that holds it together is
`src/domain/types.ts`.

## Deploy

Dockerized; `render.yaml` deploys it to Render's free tier as a Docker web
service with a `/health` check. See `DEPLOY.md`.
