import type { NovelGraph } from "./schema";
import { parseGraphJsonText } from "./ingest";

const SYSTEM_PROMPT = `你是一位頂尖的文學分析師與知識圖譜（Knowledge Graph）工程師。
深度閱讀提供的小說文本，解構為結構化資料以便渲染互動式心智圖。

# 核心分析維度（僅此四類，不要輸出其他 type）
1. Character：出場人物及其心理狀態、敘事聲音（語氣、方言、說話對象）
2. Event：推動情節的核心動作或轉折（拆成單一事件）
3. Theme：抽象哲學／情感／社會概念（孤獨、記憶、信仰…）
4. Symbol：具文學意義的道具、場景意象、象徵物

每個節點必須附原文引文（evidence.quote），絕不可捏造。

# 輸出
「絕對且只」輸出一個合法 JSON，不要 markdown 圍欄、不要解釋。

契約：
- schemaVersion: "2.0.0"
- document.language: 繁中用 "zh-Hant"
- nodes: 陣列；每項 type ∈ Character|Event|Theme|Symbol
- edges.type ∈ embodies|causes|contrasts_with|uses|recurs_in|evolves_into|related_to|participates_in
- edges.from/to 必須指向既有 nodes.id
- id 使用 n_ / e_ 前綴 ASCII slug
- evidence.quote ≤200 字且來自原文；無把握則 unverified:true
- meta.producer: { "type":"llm", "name":"openai-compatible", "model":"<model>" }
- 所有 nodes/edges 的 source 填 "llm"
- 建議 12–28 節點、15–40 邊
- 頂層僅允許: schemaVersion, document, meta, nodes, edges`;

export async function analyzeWithOpenAI(options: {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  title: string;
  text: string;
}): Promise<{ ok: true; graph: NovelGraph } | { ok: false; error: string }> {
  const baseUrl = (options.baseUrl || "https://api.openai.com/v1").replace(
    /\/$/,
    ""
  );
  const model = options.model || "gpt-4o-mini";
  const truncated =
    options.text.length > 24000
      ? options.text.slice(0, 24000) + "\n…（文本過長已截斷）"
      : options.text;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `作品標題：${options.title}\n\n全文：\n${truncated}`,
          },
        ],
      }),
    });
  } catch (e) {
    return { ok: false, error: `網路錯誤：${String(e)}` };
  }

  if (!response.ok) {
    const body = await response.text();
    return {
      ok: false,
      error: `API ${response.status}: ${body.slice(0, 400)}`,
    };
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    return { ok: false, error: "API 回傳沒有內容" };
  }

  const ingested = parseGraphJsonText(content);
  if (!ingested.ok) {
    return {
      ok: false,
      error:
        "模型輸出未通過 schema：\n" +
        ingested.issues.map((i) => `${i.path}: ${i.message}`).join("\n"),
    };
  }

  const graph = {
    ...ingested.graph,
    meta: {
      ...ingested.graph.meta,
      producer: {
        type: "llm" as const,
        name: "openai-compatible",
        model,
      },
      createdAt: new Date().toISOString(),
    },
  };

  return { ok: true, graph };
}
