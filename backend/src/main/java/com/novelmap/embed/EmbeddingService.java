package com.novelmap.embed;

import com.novelmap.config.NovelMapProperties;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.*;

@Service
public class EmbeddingService {
    private final WebClient.Builder webClientBuilder;
    private final NovelMapProperties props;

    public EmbeddingService(WebClient.Builder webClientBuilder, NovelMapProperties props) {
        this.webClientBuilder = webClientBuilder;
        this.props = props;
    }

    public List<double[]> embed(List<String> texts, String apiKey, String baseUrl, String model) {
        if (texts.isEmpty()) return List.of();
        String url = (baseUrl == null || baseUrl.isBlank() ? props.getOpenaiBaseUrl() : baseUrl)
                .replaceAll("/$", "");
        String m = model == null || model.isBlank() ? props.getEmbeddingModel() : model;

        Map<String, Object> body = Map.of(
                "model", m,
                "input", texts.stream().map(t -> t.length() > 8000 ? t.substring(0, 8000) : t).toList()
        );

        Map<String, Object> resp = webClientBuilder.build()
                .post()
                .uri(url + "/embeddings")
                .header("Authorization", "Bearer " + apiKey)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(new ParameterizedTypeReference<Map<String, Object>>() {})
                .block();

        if (resp == null || !(resp.get("data") instanceof List<?> data)) {
            throw new IllegalStateException("Embeddings response empty");
        }

        List<double[]> vectors = new ArrayList<>(Collections.nCopies(texts.size(), null));
        for (Object o : data) {
            @SuppressWarnings("unchecked")
            Map<String, Object> row = (Map<String, Object>) o;
            int index = ((Number) row.get("index")).intValue();
            @SuppressWarnings("unchecked")
            List<Number> emb = (List<Number>) row.get("embedding");
            double[] v = emb.stream().mapToDouble(Number::doubleValue).toArray();
            vectors.set(index, v);
        }
        return vectors;
    }

    public static double cosine(double[] a, double[] b) {
        if (a == null || b == null || a.length == 0 || a.length != b.length) return 0;
        double dot = 0, na = 0, nb = 0;
        for (int i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            na += a[i] * a[i];
            nb += b[i] * b[i];
        }
        double denom = Math.sqrt(na) * Math.sqrt(nb);
        return denom == 0 ? 0 : dot / denom;
    }
}
