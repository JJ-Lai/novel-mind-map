// Neo4j 5 · 無 APOC · 對齊 server/src/services/neo4j.ts
// Work / Character / Event / Theme / Symbol 以 id MERGE
// Theme 經 (:Work)-[:EXPLORES]->(:Theme) 跨作品聚合

// 範例：寫入 Work
// MERGE (w:Work {id: $workId}) SET w.title = $title ...

// 查詢作家主題
// MATCH (w:Work)-[:EXPLORES]->(t:Theme)
// WHERE $author IS NULL OR w.author = $author
// RETURN t.label, count(DISTINCT w) AS works
// ORDER BY works DESC

CREATE CONSTRAINT work_id IF NOT EXISTS FOR (w:Work) REQUIRE w.id IS UNIQUE;
CREATE CONSTRAINT character_id IF NOT EXISTS FOR (c:Character) REQUIRE c.id IS UNIQUE;
CREATE CONSTRAINT event_id IF NOT EXISTS FOR (e:Event) REQUIRE e.id IS UNIQUE;
CREATE CONSTRAINT theme_id IF NOT EXISTS FOR (t:Theme) REQUIRE t.id IS UNIQUE;
CREATE CONSTRAINT symbol_id IF NOT EXISTS FOR (s:Symbol) REQUIRE s.id IS UNIQUE;
