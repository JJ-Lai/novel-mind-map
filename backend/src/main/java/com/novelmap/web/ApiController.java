package com.novelmap.web;

import com.novelmap.chunking.TextChunkingService;
import com.novelmap.config.NovelMapProperties;
import com.novelmap.dedup.DedupService;
import com.novelmap.json.JsonSanitizerService;
import com.novelmap.model.NovelGraph;
import com.novelmap.neo4j.Neo4jGraphService;
import com.novelmap.orchestrator.AnalysisOrchestrator;
import com.novelmap.store.WorkStoreService;
import com.novelmap.verify.QuoteVerificationService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api")
public class ApiController {
    private final TextChunkingService chunkingService;
    private final JsonSanitizerService jsonSanitizerService;
    private final DedupService dedupService;
    private final QuoteVerificationService quoteVerificationService;
    private final AnalysisOrchestrator orchestrator;
    private final WorkStoreService workStoreService;
    private final Neo4jGraphService neo4jGraphService;
    private final NovelMapProperties props;

    public ApiController(
            TextChunkingService chunkingService,
            JsonSanitizerService jsonSanitizerService,
            DedupService dedupService,
            QuoteVerificationService quoteVerificationService,
            AnalysisOrchestrator orchestrator,
            WorkStoreService workStoreService,
            Neo4jGraphService neo4jGraphService,
            NovelMapProperties props
    ) {
        this.chunkingService = chunkingService;
        this.jsonSanitizerService = jsonSanitizerService;
        this.dedupService = dedupService;
        this.quoteVerificationService = quoteVerificationService;
        this.orchestrator = orchestrator;
        this.workStoreService = workStoreService;
        this.neo4jGraphService = neo4jGraphService;
        this.props = props;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", true);
        m.put("service", "novel-map-spring");
        m.put("blueprint", "full-copy");
        m.put("schemaVersion", props.getSchemaVersion());
        m.put("dedup", Map.of(
                "threshold", props.getDedupThreshold(),
                "vectorBackend", "memory",
                "embeddingModel", props.getEmbeddingModel()
        ));
        m.put("neo4j", neo4jGraphService.status());
        return m;
    }

    @PostMapping("/chunk")
    public Map<String, Object> chunk(@RequestBody Map<String, String> body) {
        List<String> chunks = chunkingService.splitText(body.getOrDefault("text", ""));
        return Map.of("chunkCount", chunks.size(), "chunks", chunks, "maxChunkLength", 3000);
    }

    @PostMapping("/sanitize")
    public ResponseEntity<?> sanitize(@RequestBody Map<String, String> body) {
        try {
            String raw = body.getOrDefault("raw", "");
            String jsonText = jsonSanitizerService.extractJson(raw);
            Object parsed = jsonSanitizerService.safeParse(raw, Object.class);
            return ResponseEntity.ok(Map.of("ok", true, "json", parsed, "jsonText", jsonText));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("ok", false, "error", e.getMessage()));
        }
    }

    @PostMapping("/dedup")
    public Map<String, Object> dedup(@RequestBody Map<String, Object> body,
                                     @RequestHeader(value = "x-api-key", required = false) String headerKey) {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> raw = (List<Map<String, Object>>) body.getOrDefault("candidates", List.of());
        List<DedupService.Candidate> candidates = raw.stream().map(m -> new DedupService.Candidate(
                String.valueOf(m.get("id")),
                String.valueOf(m.get("label")),
                m.get("summary") == null ? null : String.valueOf(m.get("summary")),
                castStringList(m.get("aliases")),
                m.get("type") == null ? null : String.valueOf(m.get("type"))
        )).toList();

        double threshold = body.get("threshold") instanceof Number n
                ? n.doubleValue()
                : props.getDedupThreshold();
        String mode = String.valueOf(body.getOrDefault("mode", "embedding"));
        String apiKey = firstNonBlank(
                body.get("apiKey") == null ? null : String.valueOf(body.get("apiKey")),
                headerKey,
                System.getenv("OPENAI_API_KEY")
        );

        if ("jaccard".equals(mode) || apiKey == null) {
            return Map.of(
                    "mode", "jaccard",
                    "backend", "none",
                    "threshold", threshold,
                    "clusters", dedupService.dedupJaccard(candidates, threshold > 0.7 ? 0.55 : threshold)
            );
        }

        String baseUrl = body.get("baseUrl") == null ? null : String.valueOf(body.get("baseUrl"));
        String model = body.get("embeddingModel") == null ? props.getEmbeddingModel() : String.valueOf(body.get("embeddingModel"));
        return dedupService.dedupEmbedding(candidates, apiKey, baseUrl, model, threshold);
    }

    @PostMapping("/verify-quotes")
    public ResponseEntity<?> verifyQuotes(@RequestBody Map<String, Object> body) {
        try {
            String text = String.valueOf(body.getOrDefault("text", ""));
            NovelGraph graph = objectFrom(body.get("graph"), NovelGraph.class);
            for (var n : graph.nodes) {
                if (n.evidence == null || n.evidence.isEmpty()) {
                    n.unverified = true;
                    continue;
                }
                boolean ok = n.evidence.stream()
                        .allMatch(e -> quoteVerificationService.quoteExistsInText(e.quote, text));
                n.unverified = !ok;
            }
            return ResponseEntity.ok(Map.of("ok", true, "graph", graph));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("ok", false, "error", e.getMessage()));
        }
    }

    @PostMapping("/analyze")
    public ResponseEntity<?> analyze(@RequestBody Map<String, Object> body,
                                     @RequestHeader(value = "x-api-key", required = false) String headerKey) {
        try {
            String title = String.valueOf(body.getOrDefault("title", "未命名"));
            String text = String.valueOf(body.getOrDefault("text", ""));
            String apiKey = firstNonBlank(
                    body.get("apiKey") == null ? null : String.valueOf(body.get("apiKey")),
                    headerKey,
                    System.getenv("OPENAI_API_KEY")
            );
            if (apiKey == null) {
                return ResponseEntity.badRequest().body(Map.of("ok", false, "error", "需要 apiKey"));
            }
            if (text.isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("ok", false, "error", "文本為空"));
            }
            List<Map<String, Object>> progress = new ArrayList<>();
            NovelGraph graph = orchestrator.analyze(
                    title,
                    text,
                    apiKey,
                    body.get("baseUrl") == null ? null : String.valueOf(body.get("baseUrl")),
                    body.get("model") == null ? null : String.valueOf(body.get("model")),
                    p -> progress.add(Map.of(
                            "phase", p.phase(),
                            "detail", p.detail(),
                            "chunkIndex", p.chunkIndex() == null ? -1 : p.chunkIndex(),
                            "chunkTotal", p.chunkTotal() == null ? -1 : p.chunkTotal()
                    ))
            );
            var saved = workStoreService.upsert(graph);
            return ResponseEntity.ok(Map.of(
                    "ok", true,
                    "graph", graph,
                    "workId", saved.record().id(),
                    "progress", progress,
                    "neo4j", saved.neo4j()
            ));
        } catch (Exception e) {
            return ResponseEntity.internalServerError().body(Map.of("ok", false, "error", e.getMessage()));
        }
    }

    @GetMapping("/works")
    public Map<String, Object> works() {
        return Map.of("works", workStoreService.listWorks());
    }

    @GetMapping("/works/{id}")
    public ResponseEntity<?> getWork(@PathVariable String id) {
        var w = workStoreService.getWork(id);
        if (w == null) return ResponseEntity.status(404).body(Map.of("ok", false, "error", "not found"));
        return ResponseEntity.ok(Map.of("ok", true, "work", w));
    }

    @PutMapping("/works")
    public ResponseEntity<?> putWork(@RequestBody Map<String, Object> body) {
        try {
            NovelGraph graph = objectFrom(body.get("graph"), NovelGraph.class);
            var saved = workStoreService.upsert(graph);
            return ResponseEntity.ok(Map.of(
                    "ok", true,
                    "work", Map.of("id", saved.record().id(), "title", saved.record().title()),
                    "neo4j", saved.neo4j()
            ));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("ok", false, "error", e.getMessage()));
        }
    }

    @DeleteMapping("/works/{id}")
    public Map<String, Object> deleteWork(@PathVariable String id) {
        return workStoreService.delete(id);
    }

    @GetMapping("/author-map")
    public Map<String, Object> authorMap(
            @RequestParam(required = false) String author,
            @RequestParam(required = false) String source
    ) {
        if ("neo4j".equals(source) && neo4jGraphService.isEnabled()) {
            return neo4jGraphService.authorMindMap(author);
        }
        return workStoreService.authorMindMap(author);
    }

    @GetMapping("/neo4j/status")
    public Map<String, Object> neo4jStatus() {
        return neo4jGraphService.status();
    }

    @PostMapping("/neo4j/sync")
    public ResponseEntity<?> neo4jSync(@RequestBody Map<String, Object> body) {
        try {
            if (!neo4jGraphService.isEnabled()) {
                return ResponseEntity.badRequest().body(Map.of("ok", false, "error", "Neo4j disabled"));
            }
            NovelGraph graph = objectFrom(body.get("graph"), NovelGraph.class);
            neo4jGraphService.ensureConstraints();
            var result = neo4jGraphService.upsertGraph(graph);
            workStoreService.upsert(graph);
            return ResponseEntity.ok(result);
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("ok", false, "error", e.getMessage()));
        }
    }

    @PostMapping("/neo4j/sync-all")
    public ResponseEntity<?> neo4jSyncAll() {
        if (!neo4jGraphService.isEnabled()) {
            return ResponseEntity.badRequest().body(Map.of("ok", false, "error", "Neo4j disabled"));
        }
        neo4jGraphService.ensureConstraints();
        List<Map<String, Object>> results = new ArrayList<>();
        for (var meta : workStoreService.listWorks()) {
            var w = workStoreService.getWork(meta.id());
            if (w != null) results.add(neo4jGraphService.upsertGraph(w.graph()));
        }
        return ResponseEntity.ok(Map.of("ok", true, "count", results.size(), "results", results));
    }

    private <T> T objectFrom(Object raw, Class<T> type) {
        return new com.fasterxml.jackson.databind.ObjectMapper().convertValue(raw, type);
    }

    @SuppressWarnings("unchecked")
    private List<String> castStringList(Object o) {
        if (!(o instanceof List<?> list)) return List.of();
        return list.stream().map(String::valueOf).toList();
    }

    private String firstNonBlank(String... values) {
        for (String v : values) {
            if (v != null && !v.isBlank()) return v;
        }
        return null;
    }
}
