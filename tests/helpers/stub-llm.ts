/**
 * A stub LLM client for testing the agent loop without a network/LLM. It plays a
 * scripted sequence of responses (text and/or tool calls), so a test can drive a
 * full conversation deterministically — the rigorous way to test an agent.
 */

import { LlmClient, type ChatMessage, type ToolSchema, type LlmResponse, type ToolCall } from '../../src/agent/llm.js';

let idSeq = 0;
function call(name: string, args: Record<string, unknown> = {}): ToolCall {
  return { id: `call_${idSeq++}`, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

export interface ScriptStep {
  /** Text the assistant says (null if this step only calls tools). */
  text?: string | null;
  /** Tool calls this step makes. */
  tools?: Array<{ name: string; args?: Record<string, unknown> }>;
}

/**
 * Build a stub LlmClient that returns the given script steps in order. Each call
 * to chat() consumes one step. When tool calls are present, the agent loop will
 * call chat() again for the next step (to respond to tool results).
 */
export function stubLlm(script: ScriptStep[]): LlmClient {
  let i = 0;
  const fetchImpl = (async () => {
    const step = script[Math.min(i, script.length - 1)];
    i++;
    const toolCalls = (step?.tools ?? []).map((t) => call(t.name, t.args ?? {}));
    const body: LlmResponseWire = {
      choices: [{ message: { content: step?.text ?? null, tool_calls: toolCalls.length ? toolCalls : undefined } }],
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;

  return new LlmClient({ baseUrl: 'http://stub', apiKey: 'stub', model: 'stub-model', fetchImpl });
}

interface LlmResponseWire {
  choices: Array<{ message: { content: string | null; tool_calls?: ToolCall[] } }>;
}

// Re-export types so tests can build messages if needed.
export type { ChatMessage, ToolSchema, LlmResponse };
