/**
 * 語意去重：
 * - embedding + 餘弦相似度（預設閾值 0.85）
 * - 可選寫入／查詢 Qdrant／Pinecone／memory 全域庫
 * - 無 API Key 時回退字元 Jaccard
 */

import {
  cosineSimilarity,
  embedInputText,
  embedTexts,
  type EmbedClientOptions,
} from "./embeddings.js";
import { getVectorStore, type VectorStore } from "./vectorStore.js";

export type DedupCandidate = {
  id: string;
  label: string;
  summary?: string;
  aliases?: string[];
  type?: string;
};

export type DedupResult = {
  canonicalId: string;
  mergedIds: string[];
  aliases: string[];
  label: string;
  scores?: number[];
};

export const DEFAULT_DEDUP_THRESHOLD = 0.85;

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

function bigrams(s: string): Set<string> {
  const t = norm(s);
  const out = new Set<string>();
  if (t.length < 2) {
    if (t) out.add(t);
    return out;
  }
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

function jaccard(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return norm(a) === norm(b) ? 1 : 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** 舊版字面去重（fallback） */
export function dedupThemes(
  candidates: DedupCandidate[],
  threshold = 0.55
): DedupResult[] {
  const clusters: DedupResult[] = [];

  for (const c of candidates) {
    let best: { idx: number; score: number } | null = null;
    for (let i = 0; i < clusters.length; i++) {
      const cl = clusters[i];
      const score = Math.max(
        jaccard(c.label, cl.label),
        ...(cl.aliases ?? []).map((a) => jaccard(c.label, a)),
        ...(c.aliases ?? []).map((a) => jaccard(a, cl.label))
      );
      if (!best || score > best.score) best = { idx: i, score };
    }
    if (best && best.score >= threshold) {
      const cl = clusters[best.idx];
      cl.mergedIds.push(c.id);
      cl.scores = [...(cl.scores ?? []), best.score];
      if (!cl.aliases.includes(c.label) && c.label !== cl.label) {
        cl.aliases.push(c.label);
      }
      for (const a of c.aliases ?? []) {
        if (!cl.aliases.includes(a) && a !== cl.label) cl.aliases.push(a);
      }
    } else {
      clusters.push({
        canonicalId: c.id,
        mergedIds: [c.id],
        aliases: [...(c.aliases ?? [])],
        label: c.label,
        scores: [],
      });
    }
  }
  return clusters;
}

export type EmbeddingDedupOptions = EmbedClientOptions & {
  threshold?: number;
  /** 寫入／查詢全域向量庫 */
  useGlobalStore?: boolean;
  workId?: string;
  store?: VectorStore;
};

/**
 * Embedding 去重：名稱+解釋 → 向量 → 餘弦 ≥ threshold 則併入既有節點。
 * 若啟用全域庫，先 query 庫中最相近 canonical，再與本批群集比對。
 */
export async function dedupThemesEmbedding(
  candidates: DedupCandidate[],
  options: EmbeddingDedupOptions
): Promise<{ clusters: DedupResult[]; mode: "embedding" | "jaccard"; backend: string }> {
  const threshold =
    options.threshold ??
    Number(process.env.DEDUP_THRESHOLD ?? DEFAULT_DEDUP_THRESHOLD);

  if (!options.apiKey || !candidates.length) {
    return {
      clusters: dedupThemes(candidates, Math.min(threshold, 0.55)),
      mode: "jaccard",
      backend: "none",
    };
  }

  const texts = candidates.map((c) => embedInputText(c.label, c.summary));
  const vectors = await embedTexts(texts, {
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    model: options.model,
  });

  type SoftCluster = DedupResult & { vector: number[]; type?: string };
  const clusters: SoftCluster[] = [];
  const store =
    options.useGlobalStore !== false
      ? options.store ?? getVectorStore()
      : null;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const vec = vectors[i];

    let bestLocal: { idx: number; score: number } | null = null;
    for (let j = 0; j < clusters.length; j++) {
      // 僅同 type 合併（Theme 不併 Symbol）
      if (c.type && clusters[j].type && c.type !== clusters[j].type) continue;
      const score = cosineSimilarity(vec, clusters[j].vector);
      if (!bestLocal || score > bestLocal.score) {
        bestLocal = { idx: j, score };
      }
    }

    let globalHit: { id: string; label: string; score: number } | null = null;
    if (store) {
      try {
        const matches = await store.query(vec, 3, c.type);
        const top = matches.find((m) => m.id && m.score >= threshold);
        if (top) {
          globalHit = {
            id: top.id,
            label: top.payload.label || c.label,
            score: top.score,
          };
        }
      } catch {
        /* 全域庫失敗不阻斷本批去重 */
      }
    }

    const useGlobal =
      globalHit &&
      (!bestLocal || globalHit.score >= bestLocal.score) &&
      globalHit.score >= threshold;

    if (useGlobal && globalHit) {
      const existing = clusters.find((cl) => cl.canonicalId === globalHit!.id);
      if (existing) {
        existing.mergedIds.push(c.id);
        existing.scores = [...(existing.scores ?? []), globalHit.score];
        if (c.label !== existing.label && !existing.aliases.includes(c.label)) {
          existing.aliases.push(c.label);
        }
      } else {
        clusters.push({
          canonicalId: globalHit.id,
          mergedIds: [c.id],
          aliases: c.label !== globalHit.label ? [c.label] : [...(c.aliases ?? [])],
          label: globalHit.label,
          vector: vec,
          type: c.type,
          scores: [globalHit.score],
        });
      }
      continue;
    }

    if (bestLocal && bestLocal.score >= threshold) {
      const cl = clusters[bestLocal.idx];
      cl.mergedIds.push(c.id);
      cl.scores = [...(cl.scores ?? []), bestLocal.score];
      if (!cl.aliases.includes(c.label) && c.label !== cl.label) {
        cl.aliases.push(c.label);
      }
      for (const a of c.aliases ?? []) {
        if (!cl.aliases.includes(a) && a !== cl.label) cl.aliases.push(a);
      }
    } else {
      clusters.push({
        canonicalId: c.id,
        mergedIds: [c.id],
        aliases: [...(c.aliases ?? [])],
        label: c.label,
        vector: vec,
        type: c.type,
        scores: [],
      });
    }
  }

  if (store) {
    try {
      await store.upsert(
        clusters.map((cl, idx) => {
          const src = candidates.find((c) => c.id === cl.canonicalId) ??
            candidates.find((c) => cl.mergedIds.includes(c.id))!;
          return {
            id: cl.canonicalId,
            values: cl.vector,
            payload: {
              label: cl.label,
              summary: src?.summary,
              type: cl.type ?? src?.type,
              workId: options.workId,
            },
          };
        })
      );
    } catch {
      /* upsert 失敗不阻斷回傳 */
    }
  }

  return {
    clusters: clusters.map(({ vector: _v, type: _t, ...rest }) => rest),
    mode: "embedding",
    backend: store?.name ?? "local-batch",
  };
}

/** 依 dedup 結果重寫 graph 的 Theme／Symbol id */
export function applyDedupToGraph(
  graph: {
    nodes: Array<{
      id: string;
      type: string;
      label: string;
      aliases?: string[];
    }>;
    edges: Array<{
      id: string;
      from: string;
      to: string;
      originalTerm?: string;
    }>;
  },
  clusters: DedupResult[]
) {
  const idMap = new Map<string, string>();
  for (const cl of clusters) {
    for (const id of cl.mergedIds) idMap.set(id, cl.canonicalId);
  }

  const aliasByCanon = new Map(
    clusters.map((c) => [c.canonicalId, c] as const)
  );

  const seen = new Set<string>();
  const nodes = graph.nodes
    .map((n) => {
      if (n.type !== "Theme" && n.type !== "Symbol") return n;
      const canon = idMap.get(n.id) ?? n.id;
      if (seen.has(canon)) return null;
      seen.add(canon);
      const cl = aliasByCanon.get(canon);
      return {
        ...n,
        id: canon,
        aliases: Array.from(
          new Set([...(n.aliases ?? []), ...(cl?.aliases ?? [])])
        ),
      };
    })
    .filter(Boolean) as typeof graph.nodes;

  const edges = graph.edges.map((e) => {
    const from = idMap.get(e.from) ?? e.from;
    const to = idMap.get(e.to) ?? e.to;
    const originalTerm =
      e.originalTerm ??
      (from !== e.from || to !== e.to
        ? graph.nodes.find((n) => n.id === e.from || n.id === e.to)?.label
        : undefined);
    return { ...e, from, to, originalTerm };
  });

  const edgeKey = new Set<string>();
  const uniqueEdges = edges.filter((e) => {
    const k = `${e.from}|${e.to}|${e.id}`;
    if (edgeKey.has(k)) return false;
    edgeKey.add(k);
    return (
      nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to)
    );
  });

  return { ...graph, nodes, edges: uniqueEdges };
}
