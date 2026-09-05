import { z } from "zod";

/** Breaking change：對齊藍圖四維度，移除 Technique / Concept / Setting / Motif */
export const SCHEMA_VERSION = "2.0.0" as const;

export const NodeTypeSchema = z.enum([
  "Character",
  "Event",
  "Theme",
  "Symbol",
]);

export const EdgeTypeSchema = z.enum([
  "embodies",
  "causes",
  "contrasts_with",
  "uses",
  "recurs_in",
  "evolves_into",
  "related_to",
  "participates_in",
]);

export const SourceSchema = z.enum(["llm", "import", "user"]);

export const EvidenceSchema = z.object({
  quote: z.string().min(1).max(200),
  locator: z
    .object({
      chapter: z.string().optional(),
      offsetStart: z.number().int().nonnegative().optional(),
      offsetEnd: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

const IdSchema = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9_\-]{1,64}$/, "id 須為英數／底線／連字號");

export const GraphNodeSchema = z.object({
  id: IdSchema,
  type: NodeTypeSchema,
  label: z.string().min(1).max(80),
  aliases: z.array(z.string().min(1)).optional(),
  summary: z.string().max(500).optional(),
  evidence: z.array(EvidenceSchema).optional(),
  attrs: z.record(z.unknown()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  unverified: z.boolean().optional(),
  source: SourceSchema,
});

export const GraphEdgeSchema = z.object({
  id: IdSchema,
  from: z.string().min(1),
  to: z.string().min(1),
  type: EdgeTypeSchema,
  label: z.string().max(80).optional(),
  evidence: z.array(EvidenceSchema).optional(),
  confidence: z.number().min(0).max(1).optional(),
  unverified: z.boolean().optional(),
  source: SourceSchema,
  /** 語意去重前的原始用詞（藍圖 Alias Pattern） */
  originalTerm: z.string().optional(),
});

export const NovelGraphSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  document: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    author: z.string().nullable().optional(),
    language: z.enum(["zh-Hant", "zh-Hans", "en", "ja", "other"]),
    workSetId: z.string().nullable().optional(),
  }),
  meta: z.object({
    createdAt: z.string().min(1),
    producer: z.object({
      type: z.enum(["llm", "agent", "human"]),
      name: z.string().min(1),
      model: z.string().optional(),
    }),
    confidenceDefault: z.number().min(0).max(1).optional(),
    notes: z.string().optional(),
  }),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});

export type NodeType = z.infer<typeof NodeTypeSchema>;
export type EdgeType = z.infer<typeof EdgeTypeSchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type NovelGraph = z.infer<typeof NovelGraphSchema>;

export const NODE_TYPE_META: Record<
  NodeType,
  { label: string; color: string; bg: string; text: string }
> = {
  Theme: {
    label: "主題",
    color: "#c0392b",
    bg: "#fde8e4",
    text: "#6b1c14",
  },
  Character: {
    label: "角色",
    color: "#8e3db8",
    bg: "#f1e4fa",
    text: "#4d1f6b",
  },
  Event: {
    label: "事件",
    color: "#2f5fad",
    bg: "#e3ecfb",
    text: "#1a3468",
  },
  Symbol: {
    label: "象徵",
    color: "#c47a12",
    bg: "#fff0d6",
    text: "#6b4208",
  },
};

export const EDGE_TYPE_LABEL: Record<EdgeType, string> = {
  embodies: "體現",
  causes: "導致",
  contrasts_with: "對立",
  uses: "運用",
  recurs_in: "反覆出現於",
  evolves_into: "演變為",
  related_to: "相關",
  participates_in: "參與",
};
