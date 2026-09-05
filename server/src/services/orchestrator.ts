import { safeParseJson } from "./jsonSanitizer.js";
import { NovelGraphSchema, type NovelGraph, type GraphNode, type GraphEdge } from "../schema.js";
import { markUnverifiedQuotes } from "./hallucination.js";
import { applyDedupToGraph, dedupThemesEmbedding } from "./dedup.js";
import { splitText } from "./chunking.js";

const CHUNK_SYSTEM = `你是文學分析師與知識圖譜工程師。只輸出 JSON，不要 markdown。
分析這一段小說文本（可能是其中一章／一切片），萃取節點與關係。

schemaVersion 必須 "2.0.0"。
nodes.type 只能是 Character|Event|Theme|Symbol。
edges.type: embodies|causes|contrasts_with|uses|recurs_in|evolves_into|related_to|participates_in
每個重要節點附 evidence.quote（原文≤200字）。
source 全部填 "llm"。
建議本切片 6–14 節點、6–18 邊。
頂層: schemaVersion, document, meta, nodes, edges。
document.title 用使用者給的標題；document.id 用 "doc_chunk"。`;

function emptyGraph(title: string, model: string): NovelGraph {
  return {
    schemaVersion: "2.0.0",
    document: {
      id: "doc_" + Date.now().toString(36),
      title,
      author: null,
      language: "zh-Hant",
      workSetId: null,
    },
    meta: {
      createdAt: new Date().toISOString(),
      producer: { type: "llm", name: "map-reduce-orchestrator", model },
      confidenceDefault: 0.7,
      notes: "Map-Reduce 合併結果",
    },
    nodes: [],
    edges: [],
  };
}

async function callLlm(options: {
  apiKey: string;
  baseUrl: string;
  model: string;
  title: string;
  chunk: string;
  chunkIndex: number;
  chunkTotal: number;
}): Promise<NovelGraph> {
  const res = await fetch(`${options.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify({
      model: options.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: CHUNK_SYSTEM },
        {
          role: "user",
          content: `作品標題：${options.title}\n切片 ${options.chunkIndex + 1}/${options.chunkTotal}：\n\n${options.chunk}`,
        },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM 無內容");
  const raw = safeParseJson(content);
  const parsed = NovelGraphSchema.safeParse(raw);
  if (!parsed.success) {
    // 寬鬆：若缺欄位嘗試補齊
    const patched = {
      schemaVersion: "2.0.0",
      document: {
        id: "doc_chunk",
        title: options.title,
        language: "zh-Hant",
        author: null,
        workSetId: null,
      },
      meta: {
        createdAt: new Date().toISOString(),
        producer: { type: "llm", name: "chunk-agent", model: options.model },
      },
      nodes: (raw as { nodes?: unknown }).nodes ?? [],
      edges: (raw as { edges?: unknown }).edges ?? [],
    };
    const retry = NovelGraphSchema.safeParse(patched);
    if (!retry.success) {
      throw new Error("切片輸出未通過 schema: " + retry.error.message);
    }
    return retry.data;
  }
  return parsed.data;
}

function mergeGraphs(parts: NovelGraph[], title: string, model: string): NovelGraph {
  const base = emptyGraph(title, model);
  const nodeMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const edgeIds = new Set<string>();

  for (const g of parts) {
    for (const n of g.nodes) {
      if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
      else {
        const prev = nodeMap.get(n.id)!;
        nodeMap.set(n.id, {
          ...prev,
          summary: prev.summary || n.summary,
          evidence: [...(prev.evidence ?? []), ...(n.evidence ?? [])].slice(0, 3),
          aliases: Array.from(
            new Set([...(prev.aliases ?? []), ...(n.aliases ?? [])])
          ),
        });
      }
    }
    for (const e of g.edges) {
      const key = e.id || `${e.from}-${e.to}-${e.type}`;
      if (edgeIds.has(key)) continue;
      edgeIds.add(key);
      edges.push({ ...e, id: key });
    }
  }

  base.nodes = [...nodeMap.values()];
  base.edges = edges.filter(
    (e) => nodeMap.has(e.from) && nodeMap.has(e.to)
  );
  return base;
}

export type AnalyzeProgress = {
  phase: string;
  detail: string;
  chunkIndex?: number;
  chunkTotal?: number;
};

export async function analyzeMapReduce(options: {
  title: string;
  text: string;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  onProgress?: (p: AnalyzeProgress) => void;
}): Promise<NovelGraph> {
  const baseUrl = (options.baseUrl || "https://api.openai.com/v1").replace(
    /\/$/,
    ""
  );
  const model = options.model || "gpt-4o-mini";
  const report = options.onProgress ?? (() => undefined);

  report({ phase: "chunk", detail: "切片中" });
  const chunks = splitText(options.text);
  if (!chunks.length) throw new Error("文本為空");

  report({
    phase: "map",
    detail: `共 ${chunks.length} 切片，開始並行抽取`,
    chunkTotal: chunks.length,
  });

  // 控制並發，避免打爆 rate limit
  const concurrency = Math.min(3, chunks.length);
  const parts: NovelGraph[] = new Array(chunks.length);
  let cursor = 0;

  async function worker() {
    while (cursor < chunks.length) {
      const i = cursor++;
      report({
        phase: "map",
        detail: `抽取切片 ${i + 1}/${chunks.length}`,
        chunkIndex: i,
        chunkTotal: chunks.length,
      });
      parts[i] = await callLlm({
        apiKey: options.apiKey,
        baseUrl,
        model,
        title: options.title,
        chunk: chunks[i],
        chunkIndex: i,
        chunkTotal: chunks.length,
      });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  report({ phase: "reduce", detail: "合併實體與關係" });
  let merged = mergeGraphs(parts, options.title, model);

  report({ phase: "dedup", detail: "Embedding 語意去重（閾值 0.85）" });
  const themeLike = merged.nodes.filter(
    (n) => n.type === "Theme" || n.type === "Symbol"
  );
  const { clusters, mode, backend } = await dedupThemesEmbedding(
    themeLike.map((n) => ({
      id: n.id,
      label: n.label,
      summary: n.summary,
      aliases: n.aliases,
      type: n.type,
    })),
    {
      apiKey: options.apiKey,
      baseUrl,
      model: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
      threshold: Number(process.env.DEDUP_THRESHOLD ?? 0.85),
      useGlobalStore: true,
      workId: merged.document.id,
    }
  );
  merged = applyDedupToGraph(merged, clusters) as NovelGraph;

  report({ phase: "verify", detail: "引文驗證" });
  merged = markUnverifiedQuotes(merged, options.text) as NovelGraph;
  merged.meta.notes = `Map-Reduce：${chunks.length} 切片；去重=${mode}/${backend} 群集 ${clusters.length}；未驗證 ${merged.nodes.filter((n) => n.unverified).length}`;

  const final = NovelGraphSchema.parse(merged);
  report({ phase: "done", detail: "完成" });
  return final;
}
