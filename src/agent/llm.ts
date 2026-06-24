/**
 * A minimal LLM client over any OpenAI-compatible chat-completions endpoint,
 * used to DRIVE the conversation via tool-calling. Provider-agnostic: it takes a
 * baseUrl, apiKey, model, and an injectable fetch (so tests stub the network and
 * no real LLM call is made).
 *
 * This is deliberately small — the agent harness (agent.ts) owns the control
 * flow and the guardrails; this file only does the HTTP round-trip and shapes
 * the OpenAI tool-calling wire format.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  /** Present on assistant messages that called tools. */
  tool_calls?: ToolCall[];
  /** Present on role:'tool' messages — the id of the call being answered. */
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LlmResponse {
  /** Assistant text, if any. */
  content: string | null;
  /** Tool calls the model wants to make, if any. */
  toolCalls: ToolCall[];
  /** Raw usage for observability. */
  usage?: { promptTokens?: number; completionTokens?: number };
}

export interface LlmClientConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Defaults to globalThis.fetch; inject a stub in tests. */
  fetchImpl?: typeof fetch;
  /** Optional headers (OpenRouter likes HTTP-Referer / X-Title). */
  headers?: Record<string, string>;
  temperature?: number;
}

export class LlmClient {
  private readonly cfg: LlmClientConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: LlmClientConfig) {
    this.cfg = cfg;
    this.fetchImpl = cfg.fetchImpl ?? globalThis.fetch;
  }

  get model(): string {
    return this.cfg.model;
  }

  /** One chat-completions round-trip with tools available. */
  async chat(messages: ChatMessage[], tools: ToolSchema[]): Promise<LlmResponse> {
    const res = await this.fetchImpl(`${this.cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.cfg.apiKey}`,
        ...this.cfg.headers,
      },
      body: JSON.stringify({
        model: this.cfg.model,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: this.cfg.temperature ?? 0.4,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`LLM request failed: ${res.status} ${res.statusText} ${body.slice(0, 300)}`);
    }

    const json = (await res.json()) as ChatCompletionResponse;
    const choice = json.choices?.[0];
    const msg = choice?.message;
    return {
      content: msg?.content ?? null,
      toolCalls: msg?.tool_calls ?? [],
      ...(json.usage
        ? {
            usage: {
              promptTokens: json.usage.prompt_tokens,
              completionTokens: json.usage.completion_tokens,
            },
          }
        : {}),
    };
  }
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

// ── Config from environment (OpenRouter, corellia-style) ──────────────────────

/**
 * Build an LlmClient from environment variables, mirroring corellia's
 * OpenRouter convention:
 *   OPENROUTER_API_KEY   — required (the agent requires a key; no static fallback)
 *   CORELLIA_MODEL_MID   — the model id (defaults to corellia's mid tier)
 *   OPENROUTER_BASE_URL  — optional override
 *
 * Throws if OPENROUTER_API_KEY is absent — the conversation IS the LLM, so a
 * missing key is a hard configuration error, surfaced clearly.
 */
export function llmFromEnv(fetchImpl?: typeof fetch): LlmClient {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is not set. The conversational agent is LLM-driven and ' +
        'requires an OpenRouter API key. Set it in .env (local) or in the Render ' +
        'dashboard (Environment → Add Environment Variable) and restart.',
    );
  }
  const baseUrl = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1';
  // Match corellia's model env; default to its mid tier for a user-facing chat.
  const model =
    process.env.TIUTNI_MODEL ??
    process.env.CORELLIA_MODEL_MID ??
    'deepseek/deepseek-v4-pro';

  return new LlmClient({
    baseUrl,
    apiKey,
    model,
    headers: {
      'HTTP-Referer': 'https://tiutni-tax-assistant.onrender.com',
      'X-Title': 'tiutni tax-filing assistant',
    },
  });
}

/** True when an OpenRouter key is configured. Used to fail fast at startup. */
export function hasLlmKey(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}
