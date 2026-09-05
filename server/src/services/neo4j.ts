import neo4j, { type Driver, type Session } from "neo4j-driver";
import type { NovelGraph, GraphEdge, GraphNode } from "../schema.js";

export type Neo4jSyncResult = {
  ok: boolean;
  enabled: boolean;
  workId?: string;
  nodesWritten?: number;
  edgesWritten?: number;
  error?: string;
};

let driver: Driver | null = null;

export function neo4jEnabled(): boolean {
  const flag = (process.env.NEO4J_ENABLED ?? "false").toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

export function getNeo4jConfig() {
  return {
    enabled: neo4jEnabled(),
    uri: process.env.NEO4J_URI || "bolt://127.0.0.1:7687",
    user: process.env.NEO4J_USER || "neo4j",
    database: process.env.NEO4J_DATABASE || "neo4j",
  };
}

function getDriver(): Driver {
  if (driver) return driver;
  const uri = process.env.NEO4J_URI || "bolt://127.0.0.1:7687";
  const user = process.env.NEO4J_USER || "neo4j";
  const password = process.env.NEO4J_PASSWORD || "password";
  driver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  return driver;
}

export async function closeNeo4j(): Promise<void> {
  if (driver) {
    await driver.close();
    driver = null;
  }
}

export async function pingNeo4j(): Promise<{ ok: boolean; error?: string }> {
  if (!neo4jEnabled()) {
    return { ok: false, error: "NEO4J_ENABLED=false" };
  }
  try {
    const d = getDriver();
    await d.verifyConnectivity();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function nodePayload(n: GraphNode) {
  return {
    id: n.id,
    label: n.label,
    summary: n.summary ?? null,
    quote: n.evidence?.[0]?.quote ?? null,
    aliases: n.aliases ?? [],
    confidence: n.confidence ?? null,
    unverified: n.unverified ?? false,
    source: n.source,
  };
}

function edgePayload(e: GraphEdge) {
  return {
    id: e.id,
    from: e.from,
    to: e.to,
    type: e.type,
    label: e.label ?? null,
    originalTerm: e.originalTerm ?? null,
    confidence: e.confidence ?? null,
    source: e.source,
  };
}

const EDGE_TYPES = [
  "embodies",
  "causes",
  "contrasts_with",
  "uses",
  "recurs_in",
  "evolves_into",
  "related_to",
  "participates_in",
] as const;

/**
 * 將整份 NovelGraph 寫入 Neo4j。
 * - Work / Character / Event / Theme / Symbol 以 id MERGE（跨作品 Theme 可共用）
 * - 先清掉該 Work 的 CONTAINS／EXPLORES／分析邊，再重建（避免殘留）
 * - 不依賴 APOC
 */
export async function upsertGraphToNeo4j(
  graph: NovelGraph
): Promise<Neo4jSyncResult> {
  if (!neo4jEnabled()) {
    return { ok: false, enabled: false, error: "Neo4j disabled" };
  }

  const workId = graph.document.id;
  const characters = graph.nodes
    .filter((n) => n.type === "Character")
    .map(nodePayload);
  const events = graph.nodes.filter((n) => n.type === "Event").map(nodePayload);
  const themes = graph.nodes.filter((n) => n.type === "Theme").map(nodePayload);
  const symbols = graph.nodes
    .filter((n) => n.type === "Symbol")
    .map(nodePayload);
  const edges = graph.edges.map(edgePayload);

  const session: Session = getDriver().session({
    database: process.env.NEO4J_DATABASE || "neo4j",
  });

  try {
    await session.executeWrite(async (tx) => {
      // 1) Work
      await tx.run(
        `
        MERGE (w:Work {id: $workId})
        SET w.title = $title,
            w.author = $author,
            w.language = $language,
            w.workSetId = $workSetId,
            w.schemaVersion = $schemaVersion,
            w.updatedAt = datetime()
        `,
        {
          workId,
          title: graph.document.title,
          author: graph.document.author ?? null,
          language: graph.document.language,
          workSetId: graph.document.workSetId ?? null,
          schemaVersion: graph.schemaVersion,
        }
      );

      // 2) 清除此作品既有分析連線與邊
      await tx.run(
        `
        MATCH ()-[r:RELATES {workId: $workId}]->()
        DELETE r
        `,
        { workId }
      );
      await tx.run(
        `
        MATCH ()-[r:EMBODIES|CAUSES|CONTRASTS_WITH|USES|RECURS_IN|EVOLVES_INTO|RELATED_TO|PARTICIPATES_IN {workId: $workId}]->()
        DELETE r
        `,
        { workId }
      );
      await tx.run(
        `
        MATCH (w:Work {id: $workId})-[r:CONTAINS|EXPLORES]->()
        DELETE r
        `,
        { workId }
      );

      // 3) 寫入各類型節點並連回 Work
      if (characters.length) {
        await tx.run(
          `
          MATCH (w:Work {id: $workId})
          UNWIND $rows AS row
          MERGE (n:Character {id: row.id})
          SET n.label = row.label,
              n.summary = row.summary,
              n.quote = row.quote,
              n.aliases = row.aliases,
              n.confidence = row.confidence,
              n.unverified = row.unverified,
              n.source = row.source,
              n.updatedAt = datetime()
          MERGE (w)-[:CONTAINS {nodeType: 'Character'}]->(n)
          `,
          { workId, rows: characters }
        );
      }

      if (events.length) {
        await tx.run(
          `
          MATCH (w:Work {id: $workId})
          UNWIND $rows AS row
          MERGE (n:Event {id: row.id})
          SET n.label = row.label,
              n.summary = row.summary,
              n.quote = row.quote,
              n.aliases = row.aliases,
              n.confidence = row.confidence,
              n.unverified = row.unverified,
              n.source = row.source,
              n.updatedAt = datetime()
          MERGE (w)-[:CONTAINS {nodeType: 'Event'}]->(n)
          `,
          { workId, rows: events }
        );
      }

      if (themes.length) {
        await tx.run(
          `
          MATCH (w:Work {id: $workId})
          UNWIND $rows AS row
          MERGE (n:Theme {id: row.id})
          SET n.label = row.label,
              n.summary = row.summary,
              n.quote = row.quote,
              n.aliases = row.aliases,
              n.confidence = row.confidence,
              n.unverified = row.unverified,
              n.source = row.source,
              n.updatedAt = datetime()
          MERGE (w)-[:CONTAINS {nodeType: 'Theme'}]->(n)
          MERGE (w)-[:EXPLORES]->(n)
          `,
          { workId, rows: themes }
        );
      }

      if (symbols.length) {
        await tx.run(
          `
          MATCH (w:Work {id: $workId})
          UNWIND $rows AS row
          MERGE (n:Symbol {id: row.id})
          SET n.label = row.label,
              n.summary = row.summary,
              n.quote = row.quote,
              n.aliases = row.aliases,
              n.confidence = row.confidence,
              n.unverified = row.unverified,
              n.source = row.source,
              n.updatedAt = datetime()
          MERGE (w)-[:CONTAINS {nodeType: 'Symbol'}]->(n)
          `,
          { workId, rows: symbols }
        );
      }

      // 4) 分析邊
      if (edges.length) {
        await tx.run(
          `
          UNWIND $edges AS e
          MATCH (a {id: e.from})
          MATCH (b {id: e.to})
          MERGE (a)-[r:RELATES {id: e.id, workId: $workId}]->(b)
          SET r.type = e.type,
              r.label = e.label,
              r.originalTerm = e.originalTerm,
              r.confidence = e.confidence,
              r.source = e.source
          `,
          { workId, edges }
        );
      }

      // 可選：為常見類型再建 typed short-name（查詢友善）
      for (const t of EDGE_TYPES) {
        const subset = edges.filter((e) => e.type === t);
        if (!subset.length) continue;
        const rel = t.toUpperCase();
        // 動態 rel type 在參數化 Cypher 中不可注入；用固定查詢表
        const cypherByType: Record<string, string> = {
          embodies: `
            UNWIND $edges AS e
            MATCH (a {id: e.from}) MATCH (b {id: e.to})
            MERGE (a)-[r:EMBODIES {id: e.id, workId: $workId}]->(b)
            SET r.originalTerm = e.originalTerm, r.confidence = e.confidence`,
          causes: `
            UNWIND $edges AS e
            MATCH (a {id: e.from}) MATCH (b {id: e.to})
            MERGE (a)-[r:CAUSES {id: e.id, workId: $workId}]->(b)
            SET r.originalTerm = e.originalTerm, r.confidence = e.confidence`,
          contrasts_with: `
            UNWIND $edges AS e
            MATCH (a {id: e.from}) MATCH (b {id: e.to})
            MERGE (a)-[r:CONTRASTS_WITH {id: e.id, workId: $workId}]->(b)
            SET r.originalTerm = e.originalTerm, r.confidence = e.confidence`,
          uses: `
            UNWIND $edges AS e
            MATCH (a {id: e.from}) MATCH (b {id: e.to})
            MERGE (a)-[r:USES {id: e.id, workId: $workId}]->(b)
            SET r.originalTerm = e.originalTerm, r.confidence = e.confidence`,
          recurs_in: `
            UNWIND $edges AS e
            MATCH (a {id: e.from}) MATCH (b {id: e.to})
            MERGE (a)-[r:RECURS_IN {id: e.id, workId: $workId}]->(b)
            SET r.originalTerm = e.originalTerm, r.confidence = e.confidence`,
          evolves_into: `
            UNWIND $edges AS e
            MATCH (a {id: e.from}) MATCH (b {id: e.to})
            MERGE (a)-[r:EVOLVES_INTO {id: e.id, workId: $workId}]->(b)
            SET r.originalTerm = e.originalTerm, r.confidence = e.confidence`,
          related_to: `
            UNWIND $edges AS e
            MATCH (a {id: e.from}) MATCH (b {id: e.to})
            MERGE (a)-[r:RELATED_TO {id: e.id, workId: $workId}]->(b)
            SET r.originalTerm = e.originalTerm, r.confidence = e.confidence`,
          participates_in: `
            UNWIND $edges AS e
            MATCH (a {id: e.from}) MATCH (b {id: e.to})
            MERGE (a)-[r:PARTICIPATES_IN {id: e.id, workId: $workId}]->(b)
            SET r.originalTerm = e.originalTerm, r.confidence = e.confidence`,
        };
        void rel;
        await tx.run(cypherByType[t], { workId, edges: subset });
      }
    });

    return {
      ok: true,
      enabled: true,
      workId,
      nodesWritten: graph.nodes.length,
      edgesWritten: graph.edges.length,
    };
  } catch (e) {
    return { ok: false, enabled: true, workId, error: String(e) };
  } finally {
    await session.close();
  }
}

export async function deleteWorkFromNeo4j(
  workId: string
): Promise<Neo4jSyncResult> {
  if (!neo4jEnabled()) {
    return { ok: false, enabled: false, error: "Neo4j disabled" };
  }
  const session = getDriver().session({
    database: process.env.NEO4J_DATABASE || "neo4j",
  });
  try {
    await session.executeWrite(async (tx) => {
      await tx.run(
        `
        MATCH ()-[r:RELATES {workId: $workId}]->()
        DELETE r
        `,
        { workId }
      );
      await tx.run(
        `
        MATCH ()-[r:EMBODIES|CAUSES|CONTRASTS_WITH|USES|RECURS_IN|EVOLVES_INTO|RELATED_TO|PARTICIPATES_IN {workId: $workId}]->()
        DELETE r
        `,
        { workId }
      );
      await tx.run(
        `
        MATCH (w:Work {id: $workId})
        DETACH DELETE w
        `,
        { workId }
      );
    });
    return { ok: true, enabled: true, workId };
  } catch (e) {
    return { ok: false, enabled: true, workId, error: String(e) };
  } finally {
    await session.close();
  }
}

/** 從 Neo4j 聚合作家主題（跨作品 EXPLORES） */
export async function authorMindMapFromNeo4j(author: string | null) {
  if (!neo4jEnabled()) {
    throw new Error("Neo4j disabled");
  }
  const session = getDriver().session({
    database: process.env.NEO4J_DATABASE || "neo4j",
  });
  try {
    const result = await session.run(
      `
      MATCH (w:Work)-[:EXPLORES]->(t:Theme)
      WHERE $author IS NULL OR w.author = $author
      WITH t.label AS label, t.id AS id, t.quote AS quote,
           collect(DISTINCT w.id) AS workIds,
           collect(DISTINCT w.title) AS workTitles,
           count(DISTINCT w) AS workCount
      RETURN label, id, quote, workIds, workTitles, workCount
      ORDER BY workCount DESC, label ASC
      LIMIT 30
      `,
      { author }
    );

    return {
      source: "neo4j",
      author,
      signatureThemes: result.records.map((r) => ({
        label: r.get("label") as string,
        id: r.get("id") as string,
        quote: r.get("quote") as string | null,
        workIds: r.get("workIds") as string[],
        workTitles: r.get("workTitles") as string[],
        count: Number(r.get("workCount")),
      })),
    };
  } finally {
    await session.close();
  }
}

export async function ensureConstraints(): Promise<void> {
  if (!neo4jEnabled()) return;
  const session = getDriver().session({
    database: process.env.NEO4J_DATABASE || "neo4j",
  });
  try {
    const stmts = [
      "CREATE CONSTRAINT work_id IF NOT EXISTS FOR (w:Work) REQUIRE w.id IS UNIQUE",
      "CREATE CONSTRAINT character_id IF NOT EXISTS FOR (c:Character) REQUIRE c.id IS UNIQUE",
      "CREATE CONSTRAINT event_id IF NOT EXISTS FOR (e:Event) REQUIRE e.id IS UNIQUE",
      "CREATE CONSTRAINT theme_id IF NOT EXISTS FOR (t:Theme) REQUIRE t.id IS UNIQUE",
      "CREATE CONSTRAINT symbol_id IF NOT EXISTS FOR (s:Symbol) REQUIRE s.id IS UNIQUE",
    ];
    for (const s of stmts) {
      await session.run(s);
    }
  } finally {
    await session.close();
  }
}
