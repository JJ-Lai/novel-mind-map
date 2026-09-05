package com.novelmap.orchestrator;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.novelmap.chunking.TextChunkingService;
import com.novelmap.config.NovelMapProperties;
import com.novelmap.dedup.DedupService;
import com.novelmap.json.JsonSanitizerService;
import com.novelmap.model.NovelGraph;
import com.novelmap.verify.QuoteVerificationService;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Consumer;

@Service
public class AnalysisOrchestrator {
    private final TextChunkingService chunkingService;
    private final JsonSanitizerService jsonSanitizerService;
    private final DedupService dedupService;
    private final QuoteVerificationService quoteVerificationService;
    private final NovelMapProperties props;
    private final WebClient.Builder webClientBuilder;
    private final ObjectMapper objectMapper;

    public AnalysisOrchestrator(
            TextChunkingService chunkingService,
            JsonSanitizerService jsonSanitizerService,
            DedupService dedupService,
            QuoteVerificationService quoteVerificationService,
            NovelMapProperties props,
            WebClient.Builder webClientBuilder,
            ObjectMapper objectMapper
    ) {
        this.chunkingService = chunkingService;
        this.jsonSanitizerService = jsonSanitizerService;
        this.dedupService = dedupService;
        this.quoteVerificationService = quoteVerificationService;
        this.props = props;
        this.webClientBuilder = webClientBuilder;
        this.objectMapper = objectMapper;
    }

    public record Progress(String phase, String detail, Integer chunkIndex, Integer chunkTotal) {}

    public NovelGraph analyze(
            String title,
            String text,
            String apiKey,
            String baseUrl,
            String model,
            Consumer<Progress> onProgress
    ) throws Exception {
        Consumer<Progress> report = onProgress == null ? p -> {} : onProgress;
        String url = (baseUrl == null || baseUrl.isBlank() ? props.getOpenaiBaseUrl() : baseUrl).replaceAll("/$", "");
        String llmModel = model == null || model.isBlank() ? "gpt-4o-mini" : model;

        report.accept(new Progress("chunk", "切片中", null, null));
        List<String> chunks = chunkingService.splitText(text);
        if (chunks.isEmpty()) throw new IllegalArgumentException("文本為空");

        report.accept(new Progress("map", "共 " + chunks.size() + " 切片，開始抽取", null, chunks.size()));

        NovelGraph[] parts = new NovelGraph[chunks.size()];
        ExecutorService pool = Executors.newFixedThreadPool(Math.min(3, chunks.size()));
        try {
            List<Future<?>> futures = new ArrayList<>();
            for (int i = 0; i < chunks.size(); i++) {
                final int idx = i;
                futures.add(pool.submit(() -> {
                    report.accept(new Progress("map", "抽取切片 " + (idx + 1) + "/" + chunks.size(), idx, chunks.size()));
                    try {
                        parts[idx] = callLlm(title, chunks.get(idx), idx, chunks.size(), apiKey, url, llmModel);
                    } catch (Exception e) {
                        throw new RuntimeException("切片 " + (idx + 1) + " 抽取失敗: " + e.getMessage(), e);
                    }
                }));
            }
            for (Future<?> f : futures) {
                try {
                    f.get();
                } catch (ExecutionException e) {
                    Throwable c = e.getCause() != null ? e.getCause() : e;
                    throw new Exception(c.getMessage(), c);
                }
            }
        } finally {
            pool.shutdown();
        }

        report.accept(new Progress("reduce", "合併實體與關係", null, null));
        NovelGraph merged = merge(parts, title, llmModel);

        report.accept(new Progress("dedup", "Embedding 語意去重", null, null));
        List<DedupService.Candidate> candidates = merged.nodes.stream()
                .filter(n -> "Theme".equals(n.type) || "Symbol".equals(n.type))
                .map(n -> new DedupService.Candidate(n.id, n.label, n.summary, n.aliases, n.type))
                .toList();
        Map<String, Object> dedup = dedupService.dedupEmbedding(
                candidates, apiKey, url, props.getEmbeddingModel(), props.getDedupThreshold());
        @SuppressWarnings("unchecked")
        List<DedupService.Cluster> clusters = (List<DedupService.Cluster>) dedup.get("clusters");
        var applied = dedupService.applyToGraph(merged.nodes, merged.edges, clusters);
        merged.nodes = applied.nodes();
        merged.edges = applied.edges();

        report.accept(new Progress("verify", "引文驗證", null, null));
        for (var n : merged.nodes) {
            if (n.evidence == null || n.evidence.isEmpty()) {
                n.unverified = true;
                continue;
            }
            boolean allOk = n.evidence.stream()
                    .allMatch(e -> quoteVerificationService.quoteExistsInText(e.quote, text));
            n.unverified = !allOk;
        }
        long unverified = merged.nodes.stream().filter(n -> Boolean.TRUE.equals(n.unverified)).count();
        merged.meta.notes = "Spring Map-Reduce：" + chunks.size() + " 切片；去重群集 "
                + clusters.size() + "；未驗證 " + unverified;

        report.accept(new Progress("done", "完成", null, null));
        return merged;
    }

    private NovelGraph callLlm(
            String title, String chunk, int index, int total,
            String apiKey, String baseUrl, String model
    ) throws Exception {
        String system = """
                你是文學分析師與知識圖譜工程師。只輸出 JSON，不要 markdown。
                schemaVersion 必須 "2.0.0"。
                nodes.type 只能是 Character|Event|Theme|Symbol。
                edges.type: embodies|causes|contrasts_with|uses|recurs_in|evolves_into|related_to|participates_in
                每個重要節點附 evidence.quote（原文≤200字）。
                source 全部填 "llm"。
                建議本切片 6–14 節點、6–18 邊。
                頂層: schemaVersion, document, meta, nodes, edges。
                """;

        Map<String, Object> body = Map.of(
                "model", model,
                "temperature", 0.2,
                "response_format", Map.of("type", "json_object"),
                "messages", List.of(
                        Map.of("role", "system", "content", system),
                        Map.of("role", "user", "content",
                                "作品標題：" + title + "\n切片 " + (index + 1) + "/" + total + "：\n\n" + chunk)
                )
        );

        Map<String, Object> resp = webClientBuilder.build()
                .post()
                .uri(baseUrl + "/chat/completions")
                .header("Authorization", "Bearer " + apiKey)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(new ParameterizedTypeReference<Map<String, Object>>() {})
                .block();

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> choices = (List<Map<String, Object>>) resp.get("choices");
        @SuppressWarnings("unchecked")
        Map<String, Object> message = (Map<String, Object>) choices.get(0).get("message");
        String content = String.valueOf(message.get("content"));
        String json = jsonSanitizerService.extractJson(content);
        NovelGraph g = objectMapper.readValue(json, NovelGraph.class);
        if (g.schemaVersion == null) g.schemaVersion = "2.0.0";
        if (g.document == null) g.document = new NovelGraph.Document();
        if (g.document.id == null) g.document.id = "doc_chunk";
        if (g.document.title == null) g.document.title = title;
        if (g.document.language == null) g.document.language = "zh-Hant";
        if (g.meta == null) g.meta = new NovelGraph.Meta();
        if (g.meta.producer == null) g.meta.producer = new NovelGraph.Producer();
        g.meta.producer.model = model;
        if (g.nodes == null) g.nodes = new ArrayList<>();
        if (g.edges == null) g.edges = new ArrayList<>();
        return g;
    }

    private NovelGraph merge(NovelGraph[] parts, String title, String model) {
        NovelGraph base = new NovelGraph();
        base.schemaVersion = "2.0.0";
        base.document.id = "doc_" + Long.toString(System.currentTimeMillis(), 36);
        base.document.title = title;
        base.document.language = "zh-Hant";
        base.meta.createdAt = Instant.now().toString();
        base.meta.producer.type = "llm";
        base.meta.producer.name = "spring-map-reduce";
        base.meta.producer.model = model;

        Map<String, NovelGraph.GraphNode> nodeMap = new LinkedHashMap<>();
        Set<String> edgeIds = new HashSet<>();
        List<NovelGraph.GraphEdge> edges = new ArrayList<>();

        for (NovelGraph g : parts) {
            if (g == null) continue;
            for (var n : g.nodes) {
                if (!nodeMap.containsKey(n.id)) nodeMap.put(n.id, n);
                else {
                    var prev = nodeMap.get(n.id);
                    if ((prev.summary == null || prev.summary.isBlank()) && n.summary != null) prev.summary = n.summary;
                }
            }
            for (var e : g.edges) {
                String key = e.id != null ? e.id : e.from + "-" + e.to + "-" + e.type;
                if (!edgeIds.add(key)) continue;
                e.id = key;
                edges.add(e);
            }
        }
        base.nodes = new ArrayList<>(nodeMap.values());
        base.edges = edges.stream()
                .filter(e -> nodeMap.containsKey(e.from) && nodeMap.containsKey(e.to))
                .toList();
        return base;
    }
}
