// 以 canonicalId 做 MERGE 鍵（勿僅用顯示名，避免同名異義）
// 參數：$workTitle $workId $chapterId $chapterSummary $nodes $edges

MERGE (w:Work {id: $workId})
SET w.title = $workTitle

MERGE (c:Chapter {id: $chapterId})
MERGE (w)-[:HAS_CHAPTER]->(c)
SET c.summary = $chapterSummary

WITH w, c
UNWIND $nodes AS row
CALL {
  WITH row, c, w
  WITH row, c, w,
       CASE row.type
         WHEN 'Character' THEN 'Character'
         WHEN 'Event' THEN 'Event'
         WHEN 'Theme' THEN 'Theme'
         WHEN 'Symbol' THEN 'Symbol'
         ELSE null
       END AS labelName
  WHERE labelName IS NOT NULL
  CALL apoc.merge.node([labelName], {id: row.id}, {
    name: row.label,
    summary: row.summary,
    quote: row.quote
  }, {}) YIELD node
  MERGE (c)-[:CONTAINS]->(node)
  FOREACH (_ IN CASE WHEN labelName = 'Theme' THEN [1] ELSE [] END |
    MERGE (w)-[:EXPLORES]->(node)
  )
  RETURN count(*) AS _
}

WITH w, c
UNWIND $edges AS e
MATCH (a {id: e.from})
MATCH (b {id: e.to})
CALL apoc.merge.relationship(a, e.type, {id: e.id}, {
  originalTerm: e.originalTerm,
  confidence: e.confidence
}, b) YIELD rel
RETURN count(rel) AS relationshipsWritten;
