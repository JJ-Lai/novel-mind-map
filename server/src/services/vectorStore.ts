/**
 * 向量庫抽象：memory（預設）／qdrant／pinecone
 * 用於跨作品全域 Theme／Symbol canonical 對齊。
 */

export type VectorPoint = {
  id: string;
  values: number[];
  payload: {
    label: string;
    summary?: string;
    type?: string;
    workId?: string;
  };
};

export type VectorMatch = {
  id: string;
  score: number;
  payload: VectorPoint["payload"];
};

export interface VectorStore {
  readonly name: string;
  upsert(points: VectorPoint[]): Promise<void>;
  query(
    vector: number[],
    topK: number,
    filterType?: string
  ): Promise<VectorMatch[]>;
}

/** 行程內記憶體向量庫（含簡單檔案可選，此處純記憶） */
export class MemoryVectorStore implements VectorStore {
  readonly name = "memory";
  private points: VectorPoint[] = [];

  async upsert(points: VectorPoint[]): Promise<void> {
    for (const p of points) {
      const i = this.points.findIndex((x) => x.id === p.id);
      if (i >= 0) this.points[i] = p;
      else this.points.push(p);
    }
  }

  async query(
    vector: number[],
    topK: number,
    filterType?: string
  ): Promise<VectorMatch[]> {
    const { cosineSimilarity } = await import("./embeddings.js");
    const scored = this.points
      .filter((p) => !filterType || p.payload.type === filterType)
      .map((p) => ({
        id: p.id,
        score: cosineSimilarity(vector, p.values),
        payload: p.payload,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    return scored;
  }
}

export class QdrantVectorStore implements VectorStore {
  readonly name = "qdrant";
  constructor(
    private url: string,
    private collection: string,
    private apiKey?: string
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) h["api-key"] = this.apiKey;
    return h;
  }

  async ensureCollection(vectorSize: number): Promise<void> {
    const base = this.url.replace(/\/$/, "");
    const list = await fetch(`${base}/collections/${this.collection}`, {
      headers: this.headers(),
    });
    if (list.ok) return;
    await fetch(`${base}/collections/${this.collection}`, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify({
        vectors: { size: vectorSize, distance: "Cosine" },
      }),
    });
  }

  async upsert(points: VectorPoint[]): Promise<void> {
    if (!points.length) return;
    await this.ensureCollection(points[0].values.length);
    const base = this.url.replace(/\/$/, "");
    const res = await fetch(
      `${base}/collections/${this.collection}/points?wait=true`,
      {
        method: "PUT",
        headers: this.headers(),
        body: JSON.stringify({
          points: points.map((p) => ({
            id: hashId(p.id),
            vector: p.values,
            payload: { ...p.payload, originalId: p.id },
          })),
        }),
      }
    );
    if (!res.ok) {
      throw new Error(`Qdrant upsert ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
  }

  async query(
    vector: number[],
    topK: number,
    filterType?: string
  ): Promise<VectorMatch[]> {
    const base = this.url.replace(/\/$/, "");
    const body: Record<string, unknown> = {
      vector,
      limit: topK,
      with_payload: true,
    };
    if (filterType) {
      body.filter = {
        must: [{ key: "type", match: { value: filterType } }],
      };
    }
    const res = await fetch(
      `${base}/collections/${this.collection}/points/search`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) {
      throw new Error(`Qdrant query ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      result: Array<{
        score: number;
        payload?: { originalId?: string; label?: string; summary?: string; type?: string };
      }>;
    };
    return (data.result ?? []).map((r) => ({
      id: String(r.payload?.originalId ?? ""),
      score: r.score,
      payload: {
        label: String(r.payload?.label ?? ""),
        summary: r.payload?.summary,
        type: r.payload?.type,
      },
    }));
  }
}

export class PineconeVectorStore implements VectorStore {
  readonly name = "pinecone";
  constructor(
    private apiKey: string,
    private host: string,
    private namespace = ""
  ) {}

  async upsert(points: VectorPoint[]): Promise<void> {
    if (!points.length) return;
    const host = this.host.replace(/\/$/, "");
    const res = await fetch(`${host}/vectors/upsert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Api-Key": this.apiKey,
      },
      body: JSON.stringify({
        namespace: this.namespace,
        vectors: points.map((p) => ({
          id: p.id.slice(0, 512),
          values: p.values,
          metadata: {
            label: p.payload.label,
            summary: p.payload.summary ?? "",
            type: p.payload.type ?? "",
            workId: p.payload.workId ?? "",
          },
        })),
      }),
    });
    if (!res.ok) {
      throw new Error(`Pinecone upsert ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
  }

  async query(
    vector: number[],
    topK: number,
    filterType?: string
  ): Promise<VectorMatch[]> {
    const host = this.host.replace(/\/$/, "");
    const body: Record<string, unknown> = {
      vector,
      topK,
      includeMetadata: true,
      namespace: this.namespace,
    };
    if (filterType) {
      body.filter = { type: { $eq: filterType } };
    }
    const res = await fetch(`${host}/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Api-Key": this.apiKey,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Pinecone query ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      matches?: Array<{
        id: string;
        score: number;
        metadata?: { label?: string; summary?: string; type?: string };
      }>;
    };
    return (data.matches ?? []).map((m) => ({
      id: m.id,
      score: m.score,
      payload: {
        label: String(m.metadata?.label ?? ""),
        summary: m.metadata?.summary,
        type: m.metadata?.type,
      },
    }));
  }
}

/** Qdrant 偏好數值 id；把字串 hash 成穩定正整數 */
function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h === 0 ? 1 : h;
}

let singleton: VectorStore | null = null;

export function getVectorStore(): VectorStore {
  if (singleton) return singleton;
  const backend = (process.env.VECTOR_BACKEND || "memory").toLowerCase();

  if (backend === "qdrant") {
    const url = process.env.QDRANT_URL || "http://127.0.0.1:6333";
    const collection = process.env.QDRANT_COLLECTION || "novel_map_themes";
    singleton = new QdrantVectorStore(
      url,
      collection,
      process.env.QDRANT_API_KEY
    );
  } else if (backend === "pinecone") {
    const apiKey = process.env.PINECONE_API_KEY;
    const host = process.env.PINECONE_HOST;
    if (!apiKey || !host) {
      throw new Error("Pinecone 需要 PINECONE_API_KEY 與 PINECONE_HOST");
    }
    singleton = new PineconeVectorStore(
      apiKey,
      host,
      process.env.PINECONE_NAMESPACE || ""
    );
  } else {
    singleton = new MemoryVectorStore();
  }
  return singleton;
}

export function vectorBackendName(): string {
  return (process.env.VECTOR_BACKEND || "memory").toLowerCase();
}
