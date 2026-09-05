package com.novelmap.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "novelmap")
public class NovelMapProperties {
    private String schemaVersion = "2.0.0";
    private double dedupThreshold = 0.85;
    private String embeddingModel = "text-embedding-3-small";
    private String openaiBaseUrl = "https://api.openai.com/v1";
    private String worksFile = "data/works.json";
    private Neo4j neo4j = new Neo4j();

    public static class Neo4j {
        private boolean enabled = false;
        private String uri = "bolt://127.0.0.1:7687";
        private String user = "neo4j";
        private String password = "password";
        private String database = "neo4j";

        public boolean isEnabled() { return enabled; }
        public void setEnabled(boolean enabled) { this.enabled = enabled; }
        public String getUri() { return uri; }
        public void setUri(String uri) { this.uri = uri; }
        public String getUser() { return user; }
        public void setUser(String user) { this.user = user; }
        public String getPassword() { return password; }
        public void setPassword(String password) { this.password = password; }
        public String getDatabase() { return database; }
        public void setDatabase(String database) { this.database = database; }
    }

    public String getSchemaVersion() { return schemaVersion; }
    public void setSchemaVersion(String schemaVersion) { this.schemaVersion = schemaVersion; }
    public double getDedupThreshold() { return dedupThreshold; }
    public void setDedupThreshold(double dedupThreshold) { this.dedupThreshold = dedupThreshold; }
    public String getEmbeddingModel() { return embeddingModel; }
    public void setEmbeddingModel(String embeddingModel) { this.embeddingModel = embeddingModel; }
    public String getOpenaiBaseUrl() { return openaiBaseUrl; }
    public void setOpenaiBaseUrl(String openaiBaseUrl) { this.openaiBaseUrl = openaiBaseUrl; }
    public String getWorksFile() { return worksFile; }
    public void setWorksFile(String worksFile) { this.worksFile = worksFile; }
    public Neo4j getNeo4j() { return neo4j; }
    public void setNeo4j(Neo4j neo4j) { this.neo4j = neo4j; }
}
