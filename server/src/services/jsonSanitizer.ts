/** 防禦性 JSON 解析 — 對齊藍圖 JsonSanitizerService */
export function extractJson(text: string): string {
  let result = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(result);
  if (fence) result = fence[1].trim();

  const start = result.indexOf("{");
  const end = result.lastIndexOf("}");
  if (start === -1 || end === -1 || start >= end) {
    throw new Error("No valid JSON structure found.");
  }
  return result.slice(start, end + 1);
}

export function safeParseJson<T = unknown>(rawAiResponse: string): T {
  return JSON.parse(extractJson(rawAiResponse)) as T;
}
