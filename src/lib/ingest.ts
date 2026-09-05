import {
  NovelGraphSchema,
  SCHEMA_VERSION,
  type GraphEdge,
  type GraphNode,
  type NovelGraph,
  type NodeType,
} from "./schema";

export type ValidationIssue = {
  path: string;
  message: string;
};

export type IngestResult =
  | { ok: true; graph: NovelGraph }
  | { ok: false; issues: ValidationIssue[] };

/** 防禦性抽取：剝 markdown fence、截取第一個完整 JSON 物件 */
export function sanitizeJsonText(text: string): string {
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

function zodIssues(err: unknown): ValidationIssue[] {
  if (
    err &&
    typeof err === "object" &&
    "issues" in err &&
    Array.isArray((err as { issues: unknown }).issues)
  ) {
    return (
      err as {
        issues: Array<{ path: (string | number)[]; message: string }>;
      }
    ).issues.map((i) => ({
      path: i.path.length ? "/" + i.path.join("/") : "/",
      message: i.message,
    }));
  }
  return [{ path: "/", message: String(err) }];
}

function graphIntegrityIssues(graph: NovelGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();

  graph.nodes.forEach((n, idx) => {
    if (nodeIds.has(n.id)) {
      issues.push({
        path: `/nodes/${idx}/id`,
        message: `重複的 node id: ${n.id}`,
      });
    }
    nodeIds.add(n.id);
  });

  graph.edges.forEach((e, idx) => {
    if (edgeIds.has(e.id)) {
      issues.push({
        path: `/edges/${idx}/id`,
        message: `重複的 edge id: ${e.id}`,
      });
    }
    edgeIds.add(e.id);
    if (!nodeIds.has(e.from)) {
      issues.push({
        path: `/edges/${idx}/from`,
        message: `找不到 from 節點: ${e.from}`,
      });
    }
    if (!nodeIds.has(e.to)) {
      issues.push({
        path: `/edges/${idx}/to`,
        message: `找不到 to 節點: ${e.to}`,
      });
    }
  });

  return issues;
}

const LEGACY_TYPE_MAP: Record<string, NodeType | null> = {
  Theme: "Theme",
  Character: "Character",
  Event: "Event",
  Symbol: "Symbol",
  Motif: "Symbol",
  Concept: "Theme",
  Setting: "Symbol",
  Technique: null,
};

type NestedBlueprint = {
  metadata?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  document?: Record<string, unknown>;
  nodes?:
    | GraphNode[]
    | {
        characters?: Array<Record<string, unknown>>;
        events?: Array<Record<string, unknown>>;
        themes?: Array<Record<string, unknown>>;
        symbols?: Array<Record<string, unknown>>;
      };
  edges?: Array<Record<string, unknown>>;
  schemaVersion?: string;
};

function slug(s: string, prefix: string): string {
  const base = s
    .normalize("NFKD")
    .replace(/[^\w\-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return `${prefix}_${base || "item"}`.replace(/[^a-zA-Z0-9_\-]/g, "_");
}

function nestedToFlat(raw: NestedBlueprint): unknown {
  const grouped = raw.nodes;
  if (!grouped || Array.isArray(grouped)) return raw;

  const nodes: GraphNode[] = [];
  const pushGroup = (
    rows: Array<Record<string, unknown>> | undefined,
    type: NodeType,
    prefix: string
  ) => {
    (rows ?? []).forEach((row, i) => {
      const label = String(row.name ?? row.label ?? `${type}_${i}`);
      const id = String(row.id ?? slug(label, prefix));
      const quote = row.quote ?? row.evidence;
      const evidence =
        typeof quote === "string"
          ? [{ quote: quote.slice(0, 200) }]
          : Array.isArray(row.evidence)
            ? (row.evidence as GraphNode["evidence"])
            : undefined;
      nodes.push({
        id,
        type,
        label: label.slice(0, 80),
        summary: String(
          row.description ?? row.explanation ?? row.summary ?? ""
        ).slice(0, 500) || undefined,
        evidence,
        source: "import",
        confidence:
          typeof row.confidence === "number" ? row.confidence : undefined,
      });
    });
  };

  pushGroup(grouped.characters, "Character", "n_char");
  pushGroup(grouped.events, "Event", "n_event");
  pushGroup(grouped.themes, "Theme", "n_theme");
  pushGroup(grouped.symbols, "Symbol", "n_sym");

  const doc = (raw.document ?? raw.metadata ?? {}) as Record<string, unknown>;
  return {
    schemaVersion: SCHEMA_VERSION,
    document: {
      id: String(doc.id ?? doc.workId ?? "doc_imported"),
      title: String(doc.title ?? doc.workTitle ?? "未命名"),
      author: (doc.author as string | null | undefined) ?? null,
      language: doc.language ?? "zh-Hant",
      workSetId: (doc.workSetId as string | null | undefined) ?? null,
    },
    meta: {
      createdAt: new Date().toISOString(),
      producer: {
        type: "agent",
        name: String(
          (raw.meta as { producer?: { name?: string } } | undefined)?.producer
            ?.name ?? "blueprint-nested-import"
        ),
      },
      confidenceDefault: 0.7,
      notes: "由藍圖巢狀 nodes 結構轉換",
    },
    nodes,
    edges: (raw.edges ?? []).map((e, i) => ({
      id: String(e.id ?? `e_${i + 1}`),
      from: String(e.from ?? e.source),
      to: String(e.to ?? e.target),
      type: e.type ?? "related_to",
      label: e.label,
      source: "import",
      originalTerm:
        typeof e.original_term === "string"
          ? e.original_term
          : typeof e.originalTerm === "string"
            ? e.originalTerm
            : undefined,
    })),
  };
}

function migrateLegacyTypes(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.nodes)) return raw;

  const dropped = new Set<string>();
  const nodes: GraphNode[] = [];
  for (const n of obj.nodes as Array<Record<string, unknown>>) {
    const mapped = LEGACY_TYPE_MAP[String(n.type)];
    if (mapped === null) {
      dropped.add(String(n.id));
      continue;
    }
    if (!mapped) continue;
    nodes.push({ ...(n as unknown as GraphNode), type: mapped });
  }

  const edges = ((obj.edges as GraphEdge[]) ?? []).filter(
    (e) => !dropped.has(e.from) && !dropped.has(e.to)
  );

  return {
    ...obj,
    schemaVersion: SCHEMA_VERSION,
    nodes,
    edges,
  };
}

export function normalizeIncomingGraph(raw: unknown): unknown {
  let cur = raw;
  if (cur && typeof cur === "object") {
    const nodes = (cur as NestedBlueprint).nodes;
    if (nodes && !Array.isArray(nodes)) {
      cur = nestedToFlat(cur as NestedBlueprint);
    }
  }
  return migrateLegacyTypes(cur);
}

export function ingestGraph(input: unknown): IngestResult {
  const normalized = normalizeIncomingGraph(input);
  const parsed = NovelGraphSchema.safeParse(normalized);
  if (!parsed.success) {
    return { ok: false, issues: zodIssues(parsed.error) };
  }
  const integrity = graphIntegrityIssues(parsed.data);
  if (integrity.length) {
    return { ok: false, issues: integrity };
  }
  return { ok: true, graph: parsed.data };
}

export function parseGraphJsonText(text: string): IngestResult {
  let cleaned: string;
  try {
    cleaned = sanitizeJsonText(text);
  } catch (e) {
    return { ok: false, issues: [{ path: "/", message: String(e) }] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(cleaned);
  } catch {
    return {
      ok: false,
      issues: [{ path: "/", message: "不是合法 JSON" }],
    };
  }
  return ingestGraph(raw);
}

export function downloadGraph(graph: NovelGraph, filename?: string) {
  const blob = new Blob([JSON.stringify(graph, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `${graph.document.id}.graph.json`;
  a.click();
  URL.revokeObjectURL(url);
}
