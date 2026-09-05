import "dotenv/config";
import express from "express";
import cors from "cors";
import { splitText } from "./services/chunking.js";
import { extractJson, safeParseJson } from "./services/jsonSanitizer.js";
import { analyzeMapReduce } from "./services/orchestrator.js";
import {
  DEFAULT_DEDUP_THRESHOLD,
  dedupThemes,
  dedupThemesEmbedding,
} from "./services/dedup.js";
import { markUnverifiedQuotes } from "./services/hallucination.js";
import { vectorBackendName } from "./services/vectorStore.js";
import {
  authorMindMapFromNeo4j,
  ensureConstraints,
  getNeo4jConfig,
  neo4jEnabled,
  pingNeo4j,
  upsertGraphToNeo4j,
} from "./services/neo4j.js";
import {
  authorMindMap,
  deleteWork,
  getWork,
  listWorks,
  upsertWork,
} from "./store.js";
import { NovelGraphSchema } from "./schema.js";

const app = express();
const PORT = Number(process.env.PORT || 8787);

app.use(cors());
app.use(express.json({ limit: "8mb" }));

app.get("/api/health", async (_req, res) => {
  const neo4jPing = neo4jEnabled() ? await pingNeo4j() : { ok: false };
  res.json({
    ok: true,
    service: "novel-map-server",
    blueprint: "full-copy",
    schemaVersion: "2.0.0",
    dedup: {
      threshold: Number(process.env.DEDUP_THRESHOLD ?? DEFAULT_DEDUP_THRESHOLD),
      vectorBackend: vectorBackendName(),
      embeddingModel:
        process.env.EMBEDDING_MODEL || "text-embedding-3-small",
    },
    neo4j: {
      ...getNeo4jConfig(),
      connected: neo4jPing.ok,
      error: "error" in neo4jPing ? neo4jPing.error : undefined,
    },
  });
});

app.post("/api/chunk", (req, res) => {
  const text = String(req.body?.text ?? "");
  const chunks = splitText(text);
  res.json({
    chunkCount: chunks.length,
    chunks,
    maxChunkLength: 3000,
  });
});

app.post("/api/sanitize", (req, res) => {
  try {
    const raw = String(req.body?.raw ?? "");
    const jsonText = extractJson(raw);
    const parsed = safeParseJson(jsonText);
    res.json({ ok: true, json: parsed, jsonText });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e) });
  }
});

app.post("/api/dedup", async (req, res) => {
  try {
    const candidates = req.body?.candidates ?? [];
    const threshold = Number(
      req.body?.threshold ??
        process.env.DEDUP_THRESHOLD ??
        DEFAULT_DEDUP_THRESHOLD
    );
    const apiKey =
      String(req.body?.apiKey ?? "") ||
      String(req.headers["x-api-key"] ?? "") ||
      process.env.OPENAI_API_KEY ||
      "";
    const mode = String(req.body?.mode ?? "embedding");

    if (mode === "jaccard" || !apiKey) {
      res.json({
        mode: "jaccard",
        backend: "none",
        threshold,
        clusters: dedupThemes(candidates, threshold > 0.7 ? 0.55 : threshold),
      });
      return;
    }

    const result = await dedupThemesEmbedding(candidates, {
      apiKey,
      baseUrl: req.body?.baseUrl,
      model: req.body?.embeddingModel || process.env.EMBEDDING_MODEL,
      threshold,
      useGlobalStore: req.body?.useGlobalStore !== false,
      workId: req.body?.workId,
    });
    res.json({ ...result, threshold });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.post("/api/verify-quotes", (req, res) => {
  try {
    const text = String(req.body?.text ?? "");
    const graph = NovelGraphSchema.parse(req.body?.graph);
    const verified = markUnverifiedQuotes(graph, text);
    res.json({ ok: true, graph: verified });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e) });
  }
});

app.post("/api/analyze", async (req, res) => {
  try {
    const title = String(req.body?.title ?? "未命名");
    const text = String(req.body?.text ?? "");
    const apiKey =
      String(req.body?.apiKey ?? "") ||
      String(req.headers["x-api-key"] ?? "") ||
      process.env.OPENAI_API_KEY ||
      "";
    if (!apiKey) {
      res.status(400).json({
        ok: false,
        error: "需要 apiKey（body / x-api-key / OPENAI_API_KEY）",
      });
      return;
    }
    if (!text.trim()) {
      res.status(400).json({ ok: false, error: "文本為空" });
      return;
    }

    const progress: unknown[] = [];
    const graph = await analyzeMapReduce({
      title,
      text,
      apiKey,
      baseUrl: req.body?.baseUrl,
      model: req.body?.model,
      onProgress: (p) => {
        progress.push(p);
      },
    });

    const saved = await upsertWork(graph);
    res.json({
      ok: true,
      graph,
      workId: saved.record.id,
      progress,
      neo4j: saved.neo4j,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get("/api/works", (_req, res) => {
  res.json({ works: listWorks() });
});

app.get("/api/works/:id", (req, res) => {
  const w = getWork(req.params.id);
  if (!w) {
    res.status(404).json({ ok: false, error: "not found" });
    return;
  }
  res.json({ ok: true, work: w });
});

app.put("/api/works", async (req, res) => {
  try {
    const graph = NovelGraphSchema.parse(req.body?.graph);
    const saved = await upsertWork(graph);
    res.json({
      ok: true,
      work: { id: saved.record.id, title: saved.record.title },
      neo4j: saved.neo4j,
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e) });
  }
});

app.delete("/api/works/:id", async (req, res) => {
  const result = await deleteWork(req.params.id);
  res.json(result);
});

app.get("/api/author-map", async (req, res) => {
  const author = req.query.author ? String(req.query.author) : null;
  const preferNeo4j = String(req.query.source ?? "") === "neo4j";
  if (preferNeo4j && neo4jEnabled()) {
    try {
      const data = await authorMindMapFromNeo4j(author);
      res.json(data);
      return;
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e) });
      return;
    }
  }
  res.json(authorMindMap(author));
});

app.post("/api/neo4j/sync", async (req, res) => {
  try {
    if (!neo4jEnabled()) {
      res.status(400).json({
        ok: false,
        error: "請設定 NEO4J_ENABLED=true 並填寫連線資訊",
      });
      return;
    }
    const graph = NovelGraphSchema.parse(req.body?.graph);
    await ensureConstraints();
    const result = await upsertGraphToNeo4j(graph);
    // 同步寫入本地 JSON
    await upsertWork(graph);
    res.json(result);
  } catch (e) {
    res.status(400).json({ ok: false, error: String(e) });
  }
});

app.post("/api/neo4j/sync-all", async (_req, res) => {
  if (!neo4jEnabled()) {
    res.status(400).json({ ok: false, error: "Neo4j disabled" });
    return;
  }
  try {
    await ensureConstraints();
    const works = listWorks();
    const results = [];
    for (const meta of works) {
      const w = getWork(meta.id);
      if (!w) continue;
      results.push(await upsertGraphToNeo4j(w.graph));
    }
    res.json({ ok: true, count: results.length, results });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

app.get("/api/neo4j/status", async (_req, res) => {
  const ping = neo4jEnabled() ? await pingNeo4j() : { ok: false, error: "disabled" };
  res.json({ ...getNeo4jConfig(), connected: ping.ok, error: ping.error });
});

async function boot() {
  if (neo4jEnabled()) {
    const ping = await pingNeo4j();
    if (ping.ok) {
      try {
        await ensureConstraints();
        console.log("[neo4j] connected · constraints ok");
      } catch (e) {
        console.warn("[neo4j] constraints failed:", e);
      }
    } else {
      console.warn("[neo4j] enabled but not connected:", ping.error);
    }
  } else {
    console.log("[neo4j] disabled (set NEO4J_ENABLED=true to write graphs)");
  }

  app.listen(PORT, () => {
    console.log(
      `novel-map-server on http://127.0.0.1:${PORT} · vector=${vectorBackendName()} · dedup≥${process.env.DEDUP_THRESHOLD ?? DEFAULT_DEDUP_THRESHOLD} · neo4j=${neo4jEnabled()}`
    );
  });
}

void boot();
