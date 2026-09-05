const API_BASE = import.meta.env.VITE_API_BASE ?? "";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export async function healthCheck(): Promise<{
  ok: boolean;
  service?: string;
  neo4j?: {
    enabled?: boolean;
    connected?: boolean;
    uri?: string;
    error?: string;
  };
}> {
  try {
    return await api("/api/health");
  } catch {
    return { ok: false };
  }
}

export async function neo4jStatus() {
  return api<{
    enabled: boolean;
    connected: boolean;
    uri: string;
    error?: string;
  }>("/api/neo4j/status");
}

export async function syncGraphToNeo4j(graph: unknown) {
  return api<{
    ok: boolean;
    workId?: string;
    nodesWritten?: number;
    edgesWritten?: number;
    error?: string;
  }>("/api/neo4j/sync", {
    method: "POST",
    body: JSON.stringify({ graph }),
  });
}

export async function chunkText(text: string) {
  return api<{ chunkCount: number; chunks: string[] }>("/api/chunk", {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function analyzeOnServer(options: {
  title: string;
  text: string;
  apiKey: string;
  baseUrl?: string;
  model?: string;
}) {
  return api<{
    ok: boolean;
    graph: unknown;
    workId: string;
    progress: Array<{ phase: string; detail: string }>;
    error?: string;
  }>("/api/analyze", {
    method: "POST",
    body: JSON.stringify(options),
  });
}

export async function listWorks() {
  return api<{ works: Array<{ id: string; title: string; author: string | null; updatedAt: string }> }>(
    "/api/works"
  );
}

export async function fetchWork(id: string) {
  return api<{ ok: boolean; work: { id: string; title: string; graph: unknown } }>(
    `/api/works/${encodeURIComponent(id)}`
  );
}

export async function saveWork(graph: unknown) {
  return api<{ ok: boolean }>("/api/works", {
    method: "PUT",
    body: JSON.stringify({ graph }),
  });
}

export async function fetchAuthorMap(author?: string | null) {
  const q = author ? `?author=${encodeURIComponent(author)}` : "";
  return api<{
    workCount: number;
    works: Array<{ id: string; title: string }>;
    signatureThemes: Array<{
      label: string;
      count: number;
      workIds: string[];
      quotes: string[];
    }>;
  }>(`/api/author-map${q}`);
}
