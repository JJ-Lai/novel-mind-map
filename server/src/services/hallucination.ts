/** 引文必須出現在原文（允許空白差異） */
export function normalizeForQuoteCheck(s: string): string {
  return s.replace(/\s+/g, "").replace(/[「」『』""']/g, "");
}

export function quoteExistsInText(quote: string, fullText: string): boolean {
  if (!quote?.trim()) return false;
  const q = normalizeForQuoteCheck(quote);
  const t = normalizeForQuoteCheck(fullText);
  return q.length > 0 && t.includes(q);
}

export type GraphLike = {
  nodes: Array<{
    id: string;
    evidence?: Array<{ quote: string }>;
    unverified?: boolean;
  }>;
};

export function markUnverifiedQuotes<T extends GraphLike>(
  graph: T,
  fullText: string
): T {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      const quotes = n.evidence ?? [];
      if (!quotes.length) {
        return { ...n, unverified: true };
      }
      const allOk = quotes.every((e) => quoteExistsInText(e.quote, fullText));
      return allOk ? { ...n, unverified: false } : { ...n, unverified: true };
    }),
  };
}
