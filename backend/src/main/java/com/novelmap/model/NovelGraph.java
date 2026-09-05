package com.novelmap.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

import java.util.ArrayList;
import java.util.List;

@JsonIgnoreProperties(ignoreUnknown = true)
public class NovelGraph {
    @NotBlank
    public String schemaVersion = "2.0.0";
    @NotNull
    public Document document = new Document();
    @NotNull
    public Meta meta = new Meta();
    @NotNull
    public List<GraphNode> nodes = new ArrayList<>();
    @NotNull
    public List<GraphEdge> edges = new ArrayList<>();

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Document {
        public String id;
        public String title;
        public String author;
        public String language = "zh-Hant";
        public String workSetId;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Meta {
        public String createdAt;
        public Producer producer = new Producer();
        public Double confidenceDefault;
        public String notes;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Producer {
        public String type = "llm";
        public String name = "spring-orchestrator";
        public String model;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class Evidence {
        public String quote;
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class GraphNode {
        public String id;
        public String type;
        public String label;
        public List<String> aliases;
        public String summary;
        public List<Evidence> evidence;
        public Double confidence;
        public Boolean unverified;
        public String source = "llm";
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class GraphEdge {
        public String id;
        public String from;
        public String to;
        public String type;
        public String label;
        public Double confidence;
        public Boolean unverified;
        public String source = "llm";
        public String originalTerm;
    }
}
