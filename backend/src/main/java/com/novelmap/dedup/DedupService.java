package com.novelmap.dedup;

import com.novelmap.embed.EmbeddingService;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
public class DedupService {
    public record Candidate(String id, String label, String summary, List<String> aliases, String type) {}
    public record Cluster(String canonicalId, List<String> mergedIds, List<String> aliases, String label, List<Double> scores) {}

    private final EmbeddingService embeddingService;

    public DedupService(EmbeddingService embeddingService) {
        this.embeddingService = embeddingService;
    }

    public List<Cluster> dedupJaccard(List<Candidate> candidates, double threshold) {
        List<Cluster> clusters = new ArrayList<>();
        for (Candidate c : candidates) {
            int bestIdx = -1;
            double best = -1;
            for (int i = 0; i < clusters.size(); i++) {
                Cluster cl = clusters.get(i);
                double score = jaccard(c.label(), cl.label());
                for (String a : cl.aliases()) score = Math.max(score, jaccard(c.label(), a));
                if (score > best) { best = score; bestIdx = i; }
            }
            if (bestIdx >= 0 && best >= threshold) {
                Cluster cl = clusters.get(bestIdx);
                cl.mergedIds().add(c.id());
                cl.scores().add(best);
                if (!cl.aliases().contains(c.label()) && !c.label().equals(cl.label())) {
                    cl.aliases().add(c.label());
                }
            } else {
                clusters.add(new Cluster(c.id(), new ArrayList<>(List.of(c.id())),
                        new ArrayList<>(c.aliases() == null ? List.of() : c.aliases()),
                        c.label(), new ArrayList<>()));
            }
        }
        return clusters;
    }

    public Map<String, Object> dedupEmbedding(
            List<Candidate> candidates,
            String apiKey,
            String baseUrl,
            String model,
            double threshold
    ) {
        Map<String, Object> out = new LinkedHashMap<>();
        if (apiKey == null || apiKey.isBlank() || candidates.isEmpty()) {
            out.put("mode", "jaccard");
            out.put("backend", "none");
            out.put("clusters", dedupJaccard(candidates, Math.min(threshold, 0.55)));
            return out;
        }

        List<String> texts = candidates.stream()
                .map(c -> c.summary() == null || c.summary().isBlank()
                        ? c.label()
                        : c.label() + "\n" + c.summary())
                .toList();
        List<double[]> vectors = embeddingService.embed(texts, apiKey, baseUrl, model);

        class Soft { Cluster c; double[] v; String type; }
        List<Soft> clusters = new ArrayList<>();

        for (int i = 0; i < candidates.size(); i++) {
            Candidate c = candidates.get(i);
            double[] vec = vectors.get(i);
            int bestIdx = -1;
            double best = -1;
            for (int j = 0; j < clusters.size(); j++) {
                Soft s = clusters.get(j);
                if (c.type() != null && s.type != null && !c.type().equals(s.type)) continue;
                double score = EmbeddingService.cosine(vec, s.v);
                if (score > best) { best = score; bestIdx = j; }
            }
            if (bestIdx >= 0 && best >= threshold) {
                Soft s = clusters.get(bestIdx);
                s.c.mergedIds().add(c.id());
                s.c.scores().add(best);
                if (!s.c.aliases().contains(c.label()) && !c.label().equals(s.c.label())) {
                    s.c.aliases().add(c.label());
                }
            } else {
                Soft s = new Soft();
                s.c = new Cluster(c.id(), new ArrayList<>(List.of(c.id())),
                        new ArrayList<>(c.aliases() == null ? List.of() : c.aliases()),
                        c.label(), new ArrayList<>());
                s.v = vec;
                s.type = c.type();
                clusters.add(s);
            }
        }

        out.put("mode", "embedding");
        out.put("backend", "memory");
        out.put("threshold", threshold);
        out.put("clusters", clusters.stream().map(s -> s.c).toList());
        return out;
    }

    public NovelGraphApply applyToGraph(
            List<com.novelmap.model.NovelGraph.GraphNode> nodes,
            List<com.novelmap.model.NovelGraph.GraphEdge> edges,
            List<Cluster> clusters
    ) {
        Map<String, String> idMap = new HashMap<>();
        Map<String, Cluster> byCanon = new HashMap<>();
        for (Cluster cl : clusters) {
            byCanon.put(cl.canonicalId(), cl);
            for (String id : cl.mergedIds()) idMap.put(id, cl.canonicalId());
        }

        Set<String> seen = new HashSet<>();
        List<com.novelmap.model.NovelGraph.GraphNode> outNodes = new ArrayList<>();
        for (var n : nodes) {
            if (!"Theme".equals(n.type) && !"Symbol".equals(n.type)) {
                outNodes.add(n);
                continue;
            }
            String canon = idMap.getOrDefault(n.id, n.id);
            if (!seen.add(canon)) continue;
            Cluster cl = byCanon.get(canon);
            n.id = canon;
            Set<String> aliases = new LinkedHashSet<>();
            if (n.aliases != null) aliases.addAll(n.aliases);
            if (cl != null) aliases.addAll(cl.aliases());
            n.aliases = new ArrayList<>(aliases);
            outNodes.add(n);
        }

        Set<String> edgeKeys = new HashSet<>();
        List<com.novelmap.model.NovelGraph.GraphEdge> outEdges = new ArrayList<>();
        for (var e : edges) {
            String from = idMap.getOrDefault(e.from, e.from);
            String to = idMap.getOrDefault(e.to, e.to);
            if (!from.equals(e.from) || !to.equals(e.to)) {
                if (e.originalTerm == null) e.originalTerm = e.from;
            }
            e.from = from;
            e.to = to;
            String key = e.from + "|" + e.to + "|" + e.id;
            if (!edgeKeys.add(key)) continue;
            boolean ok = outNodes.stream().anyMatch(n -> n.id.equals(e.from))
                    && outNodes.stream().anyMatch(n -> n.id.equals(e.to));
            if (ok) outEdges.add(e);
        }
        return new NovelGraphApply(outNodes, outEdges);
    }

    public record NovelGraphApply(
            List<com.novelmap.model.NovelGraph.GraphNode> nodes,
            List<com.novelmap.model.NovelGraph.GraphEdge> edges
    ) {}

    private double jaccard(String a, String b) {
        Set<String> A = bigrams(a);
        Set<String> B = bigrams(b);
        if (A.isEmpty() || B.isEmpty()) {
            return norm(a).equals(norm(b)) ? 1.0 : 0.0;
        }
        int inter = 0;
        for (String x : A) if (B.contains(x)) inter++;
        return inter / (double) (A.size() + B.size() - inter);
    }

    private Set<String> bigrams(String s) {
        String t = norm(s);
        Set<String> out = new LinkedHashSet<>();
        if (t.length() < 2) {
            if (!t.isEmpty()) out.add(t);
            return out;
        }
        for (int i = 0; i < t.length() - 1; i++) out.add(t.substring(i, i + 2));
        return out;
    }

    private String norm(String s) {
        return s == null ? "" : s.trim().toLowerCase(Locale.ROOT).replaceAll("\\s+", "");
    }
}
