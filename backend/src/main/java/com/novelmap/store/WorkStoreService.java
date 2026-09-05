package com.novelmap.store;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.novelmap.config.NovelMapProperties;
import com.novelmap.model.NovelGraph;
import com.novelmap.neo4j.Neo4jGraphService;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;

@Service
public class WorkStoreService {
    public record WorkMeta(String id, String title, String author, String updatedAt) {}
    public record WorkRecord(String id, String title, String author, String updatedAt, NovelGraph graph) {}
    public record UpsertResult(WorkRecord record, Map<String, Object> neo4j) {}

    private final Path storePath;
    private final ObjectMapper mapper;
    private final Neo4jGraphService neo4jGraphService;
    private final Map<String, WorkRecord> cache = new ConcurrentHashMap<>();

    public WorkStoreService(
            NovelMapProperties props,
            ObjectMapper mapper,
            Neo4jGraphService neo4jGraphService
    ) throws IOException {
        this.mapper = mapper;
        this.neo4jGraphService = neo4jGraphService;
        this.storePath = Path.of(props.getWorksFile()).toAbsolutePath();
        load();
    }

    private void load() throws IOException {
        Files.createDirectories(storePath.getParent());
        if (!Files.exists(storePath)) {
            mapper.writerWithDefaultPrettyPrinter()
                    .writeValue(storePath.toFile(), Map.of("works", List.of()));
            return;
        }
        Map<?, ?> root = mapper.readValue(storePath.toFile(), Map.class);
        Object works = root.get("works");
        if (works instanceof List<?> list) {
            for (Object o : list) {
                WorkRecord rec = mapper.convertValue(o, WorkRecord.class);
                cache.put(rec.id(), rec);
            }
        }
    }

    private synchronized void persist() {
        try {
            Map<String, Object> root = Map.of("works", new ArrayList<>(cache.values()));
            mapper.writerWithDefaultPrettyPrinter().writeValue(storePath.toFile(), root);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to persist works.json", e);
        }
    }

    public List<WorkMeta> listWorks() {
        return cache.values().stream()
                .map(w -> new WorkMeta(w.id(), w.title(), w.author(), w.updatedAt()))
                .sorted(Comparator.comparing(WorkMeta::updatedAt).reversed())
                .collect(Collectors.toList());
    }

    public WorkRecord getWork(String id) {
        return cache.get(id);
    }

    public UpsertResult upsert(NovelGraph graph) {
        String id = graph.document.id;
        WorkRecord rec = new WorkRecord(
                id,
                graph.document.title,
                graph.document.author,
                Instant.now().toString(),
                graph
        );
        cache.put(id, rec);
        persist();
        Map<String, Object> neo = neo4jGraphService.upsertGraph(graph);
        return new UpsertResult(rec, neo);
    }

    public Map<String, Object> delete(String id) {
        boolean ok = cache.remove(id) != null;
        if (ok) persist();
        Map<String, Object> neo = ok ? neo4jGraphService.deleteWork(id) : Map.of("ok", false);
        return Map.of("ok", ok, "neo4j", neo);
    }

    public Map<String, Object> authorMindMap(String author) {
        List<WorkRecord> works = cache.values().stream()
                .filter(w -> author == null || author.equals(w.author())
                        || (w.graph().document.author != null && author.equals(w.graph().document.author)))
                .toList();

        Map<String, Map<String, Object>> themeFreq = new LinkedHashMap<>();
        for (WorkRecord w : works) {
            for (NovelGraph.GraphNode n : w.graph().nodes) {
                if (!"Theme".equals(n.type)) continue;
                String key = n.label == null ? "" : n.label.trim();
                Map<String, Object> cur = themeFreq.computeIfAbsent(key, k -> {
                    Map<String, Object> m = new LinkedHashMap<>();
                    m.put("label", n.label);
                    m.put("count", 0);
                    m.put("workIds", new ArrayList<String>());
                    m.put("quotes", new ArrayList<String>());
                    return m;
                });
                cur.put("count", ((Integer) cur.get("count")) + 1);
                @SuppressWarnings("unchecked")
                List<String> workIds = (List<String>) cur.get("workIds");
                if (!workIds.contains(w.id())) workIds.add(w.id());
                if (n.evidence != null && !n.evidence.isEmpty() && n.evidence.get(0).quote != null) {
                    @SuppressWarnings("unchecked")
                    List<String> quotes = (List<String>) cur.get("quotes");
                    if (quotes.size() < 3) quotes.add(n.evidence.get(0).quote);
                }
            }
        }

        List<Map<String, Object>> themes = themeFreq.values().stream()
                .sorted((a, b) -> Integer.compare((Integer) b.get("count"), (Integer) a.get("count")))
                .limit(20)
                .toList();

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("source", "json");
        out.put("author", author);
        out.put("workCount", works.size());
        out.put("works", works.stream().map(w -> Map.of("id", w.id(), "title", w.title())).toList());
        out.put("signatureThemes", themes);
        return out;
    }
}
