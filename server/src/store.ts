import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { NovelGraph } from "./schema.js";
import {
  deleteWorkFromNeo4j,
  neo4jEnabled,
  upsertGraphToNeo4j,
  type Neo4jSyncResult,
} from "./services/neo4j.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "..", "..", "data");
const STORE_FILE = join(DATA_DIR, "works.json");

export type WorkRecord = {
  id: string;
  title: string;
  author: string | null;
  updatedAt: string;
  graph: NovelGraph;
};

type StoreShape = { works: WorkRecord[] };

function ensure() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(STORE_FILE)) {
    writeFileSync(STORE_FILE, JSON.stringify({ works: [] }, null, 2), "utf8");
  }
}

function readStore(): StoreShape {
  ensure();
  return JSON.parse(readFileSync(STORE_FILE, "utf8")) as StoreShape;
}

function writeStore(store: StoreShape) {
  ensure();
  writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
}

export function listWorks(): Omit<WorkRecord, "graph">[] {
  return readStore().works.map(({ id, title, author, updatedAt }) => ({
    id,
    title,
    author,
    updatedAt,
  }));
}

export function getWork(id: string): WorkRecord | undefined {
  return readStore().works.find((w) => w.id === id);
}

export async function upsertWork(
  graph: NovelGraph
): Promise<{ record: WorkRecord; neo4j: Neo4jSyncResult | null }> {
  const store = readStore();
  const id = graph.document.id;
  const rec: WorkRecord = {
    id,
    title: graph.document.title,
    author: graph.document.author ?? null,
    updatedAt: new Date().toISOString(),
    graph,
  };
  const idx = store.works.findIndex((w) => w.id === id);
  if (idx >= 0) store.works[idx] = rec;
  else store.works.push(rec);
  writeStore(store);

  let neo4jResult: Neo4jSyncResult | null = null;
  if (neo4jEnabled()) {
    neo4jResult = await upsertGraphToNeo4j(graph);
  }
  return { record: rec, neo4j: neo4jResult };
}

export async function deleteWork(
  id: string
): Promise<{ ok: boolean; neo4j: Neo4jSyncResult | null }> {
  const store = readStore();
  const before = store.works.length;
  store.works = store.works.filter((w) => w.id !== id);
  writeStore(store);
  const ok = store.works.length < before;

  let neo4jResult: Neo4jSyncResult | null = null;
  if (neo4jEnabled() && ok) {
    neo4jResult = await deleteWorkFromNeo4j(id);
  }
  return { ok, neo4j: neo4jResult };
}

/** 跨作品 Theme 聚合（本地 JSON 輕量版） */
export function authorMindMap(author: string | null) {
  const store = readStore();
  const works = store.works.filter((w) =>
    author ? w.author === author || w.graph.document.author === author : true
  );

  const themeFreq = new Map<
    string,
    { label: string; count: number; workIds: string[]; quotes: string[] }
  >();

  for (const w of works) {
    for (const n of w.graph.nodes.filter((x) => x.type === "Theme")) {
      const key = n.label.trim();
      const cur = themeFreq.get(key) ?? {
        label: n.label,
        count: 0,
        workIds: [],
        quotes: [],
      };
      cur.count += 1;
      if (!cur.workIds.includes(w.id)) cur.workIds.push(w.id);
      const q = n.evidence?.[0]?.quote;
      if (q && cur.quotes.length < 3) cur.quotes.push(q);
      themeFreq.set(key, cur);
    }
  }

  const themes = [...themeFreq.values()].sort((a, b) => b.count - a.count);

  return {
    source: "json",
    author,
    workCount: works.length,
    works: works.map((w) => ({ id: w.id, title: w.title })),
    signatureThemes: themes.slice(0, 20),
  };
}
