/** OpenAI-compatible embeddings */

export type EmbedClientOptions = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
};

export async function embedTexts(
  texts: string[],
  options: EmbedClientOptions
): Promise<number[][]> {
  if (!texts.length) return [];
  const baseUrl = (options.baseUrl || "https://api.openai.com/v1").replace(
    /\/$/,
    ""
  );
  const model = options.model || "text-embedding-3-small";

  const res = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: texts.map((t) => t.slice(0, 8000)),
    }),
  });

  if (!res.ok) {
    throw new Error(`Embeddings ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }

  const data = (await res.json()) as {
    data: Array<{ embedding: number[]; index: number }>;
  };

  return data.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function embedInputText(label: string, summary?: string): string {
  return summary?.trim() ? `${label}\n${summary.trim()}` : label;
}
