export const OLLAMA_MODEL = "qwen3:4b";

export type ToolCall = { name: string; arguments: Record<string, unknown> };

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: { function: ToolCall }[] }
  | { role: "tool"; tool_name: string; content: string };

export type ToolSpec = {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
};

function asArguments(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      return asArguments(JSON.parse(value));
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export async function chatTools(
  tools: ToolSpec[],
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<{ content: string; calls: ToolCall[] }> {
  const response = await fetch("/ollama/api/chat", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      // With tools attached, qwen3 ignores think:false and reasons in the reply text,
      // running out of tokens before the call. With thinking on, the reasoning goes to
      // its own field and the tool call comes out clean.
      think: true,
      keep_alive: "10m",
      tools,
      options: { temperature: 0, num_predict: 1024 },
      messages,
    }),
  });
  if (!response.ok) throw new Error(`Ollama answered ${response.status}`);
  const data = (await response.json()) as {
    message?: { content?: string; tool_calls?: { function?: { name?: unknown; arguments?: unknown } }[] };
  };
  const calls = (data.message?.tool_calls ?? []).flatMap((call) => {
    const name = call.function?.name;
    return typeof name === "string" ? [{ name, arguments: asArguments(call.function?.arguments) }] : [];
  });
  return { content: data.message?.content ?? "", calls };
}

export async function chat(
  schema: unknown,
  temperature: number,
  limit: number,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch("/ollama/api/chat", {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      think: false,
      keep_alive: "10m",
      format: schema,
      options: { temperature, num_predict: limit },
      messages,
    }),
  });
  if (!response.ok) throw new Error(`Ollama answered ${response.status}`);
  const data = (await response.json()) as { message?: { content?: string } };
  return data.message?.content ?? "";
}

export function askModel(
  schema: unknown,
  temperature: number,
  limit: number,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<string> {
  return chat(
    schema,
    temperature,
    limit,
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    signal,
  );
}
