import { z } from "zod";

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

export const GraphNodeSchema = z.object({
  id: z.string().min(1),
  type: NodeTypeSchema,
  label: z.string().min(1).max(80),
  aliases: z.array(z.string()).optional(),
  summary: z.string().max(500).optional(),
  evidence: z
    .array(z.object({ quote: z.string().min(1).max(200) }))
    .optional(),
  confidence: z.number().min(0).max(1).optional(),
  unverified: z.boolean().optional(),
  source: z.enum(["llm", "import", "user"]),
});

export const GraphEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  type: EdgeTypeSchema,
  label: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  unverified: z.boolean().optional(),
  source: z.enum(["llm", "import", "user"]),
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
    createdAt: z.string(),
    producer: z.object({
      type: z.enum(["llm", "agent", "human"]),
      name: z.string(),
      model: z.string().optional(),
    }),
    confidenceDefault: z.number().optional(),
    notes: z.string().optional(),
  }),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
});

export type NovelGraph = z.infer<typeof NovelGraphSchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
