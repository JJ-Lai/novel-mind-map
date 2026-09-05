package com.novelmap.neo4j;

import com.novelmap.config.NovelMapProperties;
import com.novelmap.model.NovelGraph;
import org.neo4j.driver.AuthTokens;
import org.neo4j.driver.Driver;
import org.neo4j.driver.GraphDatabase;
import org.neo4j.driver.Session;
import org.neo4j.driver.SessionConfig;
import org.neo4j.driver.Values;
import org.springframework.stereotype.Service;

import jakarta.annotation.PreDestroy;
import java.util.*;

@Service
public class Neo4jGraphService {
    private final NovelMapProperties props;
    private Driver driver;

    public Neo4jGraphService(NovelMapProperties props) {
        this.props = props;
    }

    public boolean isEnabled() {
        return props.getNeo4j().isEnabled();
    }

    private synchronized Driver driver() {
        if (driver == null) {
            var n = props.getNeo4j();
            driver = GraphDatabase.driver(n.getUri(), AuthTokens.basic(n.getUser(), n.getPassword()));
        }
        return driver;
    }

    public Map<String, Object> status() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("enabled", isEnabled());
        m.put("uri", props.getNeo4j().getUri());
        m.put("user", props.getNeo4j().getUser());
        m.put("database", props.getNeo4j().getDatabase());
        if (!isEnabled()) {
            m.put("connected", false);
            m.put("error", "NEO4J disabled");
            return m;
        }
        try {
            driver().verifyConnectivity();
            m.put("connected", true);
        } catch (Exception e) {
            m.put("connected", false);
            m.put("error", e.getMessage());
        }
        return m;
    }

    public void ensureConstraints() {
        if (!isEnabled()) return;
        try (Session session = session()) {
            List<String> stmts = List.of(
                    "CREATE CONSTRAINT work_id IF NOT EXISTS FOR (w:Work) REQUIRE w.id IS UNIQUE",
                    "CREATE CONSTRAINT character_id IF NOT EXISTS FOR (c:Character) REQUIRE c.id IS UNIQUE",
                    "CREATE CONSTRAINT event_id IF NOT EXISTS FOR (e:Event) REQUIRE e.id IS UNIQUE",
                    "CREATE CONSTRAINT theme_id IF NOT EXISTS FOR (t:Theme) REQUIRE t.id IS UNIQUE",
                    "CREATE CONSTRAINT symbol_id IF NOT EXISTS FOR (s:Symbol) REQUIRE s.id IS UNIQUE"
            );
            for (String s : stmts) session.run(s);
        }
    }

    private Session session() {
        return driver().session(SessionConfig.forDatabase(props.getNeo4j().getDatabase()));
    }

    public Map<String, Object> upsertGraph(NovelGraph graph) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("enabled", isEnabled());
        if (!isEnabled()) {
            out.put("ok", false);
            out.put("error", "Neo4j disabled");
            return out;
        }
        String workId = graph.document.id;
        try (Session session = session()) {
            session.executeWrite(tx -> {
                tx.run("""
                        MERGE (w:Work {id: $workId})
                        SET w.title = $title,
                            w.author = $author,
                            w.language = $language,
                            w.workSetId = $workSetId,
                            w.schemaVersion = $schemaVersion,
                            w.updatedAt = datetime()
                        """,
                        Values.parameters(
                                "workId", workId,
                                "title", graph.document.title,
                                "author", graph.document.author,
                                "language", graph.document.language,
                                "workSetId", graph.document.workSetId,
                                "schemaVersion", graph.schemaVersion
                        ));

                tx.run("MATCH ()-[r:RELATES {workId: $workId}]->() DELETE r",
                        Values.parameters("workId", workId));
                tx.run("""
                        MATCH ()-[r:EMBODIES|CAUSES|CONTRASTS_WITH|USES|RECURS_IN|EVOLVES_INTO|RELATED_TO|PARTICIPATES_IN {workId: $workId}]->()
                        DELETE r
                        """, Values.parameters("workId", workId));
                tx.run("MATCH (w:Work {id: $workId})-[r:CONTAINS|EXPLORES]->() DELETE r",
                        Values.parameters("workId", workId));

                writeNodes(tx, workId, graph.nodes.stream().filter(n -> "Character".equals(n.type)).toList(), "Character", false);
                writeNodes(tx, workId, graph.nodes.stream().filter(n -> "Event".equals(n.type)).toList(), "Event", false);
                writeNodes(tx, workId, graph.nodes.stream().filter(n -> "Theme".equals(n.type)).toList(), "Theme", true);
                writeNodes(tx, workId, graph.nodes.stream().filter(n -> "Symbol".equals(n.type)).toList(), "Symbol", false);

                if (!graph.edges.isEmpty()) {
                    List<Map<String, Object>> edges = graph.edges.stream().map(this::edgeMap).toList();
                    tx.run("""
                            UNWIND $edges AS e
                            MATCH (a {id: e.from})
                            MATCH (b {id: e.to})
                            MERGE (a)-[r:RELATES {id: e.id, workId: $workId}]->(b)
                            SET r.type = e.type,
                                r.label = e.label,
                                r.originalTerm = e.originalTerm,
                                r.confidence = e.confidence,
                                r.source = e.source
                            """, Values.parameters("workId", workId, "edges", edges));
                }
                return null;
            });
            out.put("ok", true);
            out.put("workId", workId);
            out.put("nodesWritten", graph.nodes.size());
            out.put("edgesWritten", graph.edges.size());
        } catch (Exception e) {
            out.put("ok", false);
            out.put("workId", workId);
            out.put("error", e.getMessage());
        }
        return out;
    }

    private void writeNodes(
            org.neo4j.driver.TransactionContext tx,
            String workId,
            List<NovelGraph.GraphNode> nodes,
            String label,
            boolean explores
    ) {
        if (nodes.isEmpty()) return;
        List<Map<String, Object>> rows = nodes.stream().map(this::nodeMap).toList();
        String cypher = """
                MATCH (w:Work {id: $workId})
                UNWIND $rows AS row
                MERGE (n:%s {id: row.id})
                SET n.label = row.label,
                    n.summary = row.summary,
                    n.quote = row.quote,
                    n.aliases = row.aliases,
                    n.confidence = row.confidence,
                    n.unverified = row.unverified,
                    n.source = row.source,
                    n.updatedAt = datetime()
                MERGE (w)-[:CONTAINS {nodeType: $nodeType}]->(n)
                %s
                """.formatted(label, explores ? "MERGE (w)-[:EXPLORES]->(n)" : "");
        tx.run(cypher, Values.parameters(
                "workId", workId,
                "rows", rows,
                "nodeType", label
        ));
    }

    private Map<String, Object> nodeMap(NovelGraph.GraphNode n) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", n.id);
        m.put("label", n.label);
        m.put("summary", n.summary);
        m.put("quote", n.evidence != null && !n.evidence.isEmpty() ? n.evidence.get(0).quote : null);
        m.put("aliases", n.aliases == null ? List.of() : n.aliases);
        m.put("confidence", n.confidence);
        m.put("unverified", Boolean.TRUE.equals(n.unverified));
        m.put("source", n.source);
        return m;
    }

    private Map<String, Object> edgeMap(NovelGraph.GraphEdge e) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", e.id);
        m.put("from", e.from);
        m.put("to", e.to);
        m.put("type", e.type);
        m.put("label", e.label);
        m.put("originalTerm", e.originalTerm);
        m.put("confidence", e.confidence);
        m.put("source", e.source);
        return m;
    }

    public Map<String, Object> deleteWork(String workId) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("enabled", isEnabled());
        if (!isEnabled()) {
            out.put("ok", false);
            out.put("error", "Neo4j disabled");
            return out;
        }
        try (Session session = session()) {
            session.executeWrite(tx -> {
                tx.run("MATCH ()-[r:RELATES {workId: $workId}]->() DELETE r",
                        Values.parameters("workId", workId));
                tx.run("""
                        MATCH ()-[r:EMBODIES|CAUSES|CONTRASTS_WITH|USES|RECURS_IN|EVOLVES_INTO|RELATED_TO|PARTICIPATES_IN {workId: $workId}]->()
                        DELETE r
                        """, Values.parameters("workId", workId));
                tx.run("MATCH (w:Work {id: $workId}) DETACH DELETE w",
                        Values.parameters("workId", workId));
                return null;
            });
            out.put("ok", true);
            out.put("workId", workId);
        } catch (Exception e) {
            out.put("ok", false);
            out.put("workId", workId);
            out.put("error", e.getMessage());
        }
        return out;
    }

    public Map<String, Object> authorMindMap(String author) {
        try (Session session = session()) {
            var result = session.run("""
                    MATCH (w:Work)-[:EXPLORES]->(t:Theme)
                    WHERE $author IS NULL OR w.author = $author
                    WITH t.label AS label, t.id AS id, t.quote AS quote,
                         collect(DISTINCT w.id) AS workIds,
                         collect(DISTINCT w.title) AS workTitles,
                         count(DISTINCT w) AS workCount
                    RETURN label, id, quote, workIds, workTitles, workCount
                    ORDER BY workCount DESC, label ASC
                    LIMIT 30
                    """, Values.parameters("author", author));
            List<Map<String, Object>> themes = new ArrayList<>();
            result.forEachRemaining(r -> {
                Map<String, Object> m = new LinkedHashMap<>();
                m.put("label", r.get("label").asString());
                m.put("id", r.get("id").asString());
                m.put("quote", r.get("quote").isNull() ? null : r.get("quote").asString());
                m.put("workIds", r.get("workIds").asList());
                m.put("workTitles", r.get("workTitles").asList());
                m.put("count", r.get("workCount").asInt());
                themes.add(m);
            });
            return Map.of(
                    "source", "neo4j",
                    "author", author == null ? "" : author,
                    "signatureThemes", themes
            );
        }
    }

    @PreDestroy
    public void close() {
        if (driver != null) driver.close();
    }
}
