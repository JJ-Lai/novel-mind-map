# 小說地圖 — 正式開發藍圖（全抄對齊版）

> 本文件採納外部高階 AI 藍圖之完整流程，並與前端契約 `schemaVersion: "2.0.0"` 對齊。  
> **不保留 Technique**；分析維度僅四類：**Character / Event / Theme / Symbol**。

---

## 一、核心功能架構

結合 **NLP（LLM 抽取）**、**向量檢索（語意去重）**、**圖形資料庫（跨作品聚合）**：

1. **單篇小說解構**：萃取角色、事件、主題、象徵，生成互動式星系心智圖。  
2. **小說家心靈地圖**：跨作品聚合主題母題，呈現作者宏觀創作星系。

### 現行前端（已交付）

- React + React Flow 星系圖（標題為核心）  
- Zod／JSON Schema 驗證、JSON 匯入／匯出  
- JsonSanitizer（剝 markdown）、巢狀藍圖格式 → flat nodes 轉換  
- 舊型別遷移：`Motif→Symbol`、`Concept→Theme`、`Setting→Symbol`、`Technique` 丟棄  

### 目標後端（藍圖全抄）

| 元件 | 技術選定 |
|------|----------|
| API | Java Spring Boot |
| 圖庫 | Neo4j（`MERGE` + `UNWIND`） |
| 向量 | Pinecone / Qdrant（餘弦相似度，閾值預設 0.85） |
| 前端排版 | React Flow（星系為主；可加 dagre 作章節樹） |

---

## 二、AI Prompt 規範（單章）

見 `specs/AGENT_PROMPT.md` 與 `src/lib/llm.ts`。要點：

- 只輸出 JSON；強制原文 `evidence.quote`  
- 四維度：角色／事件／主題／象徵  
- 最終寫入 flat `nodes[]` + `edges[]`，`schemaVersion: "2.0.0"`  

亦接受藍圖巢狀形狀：

```json
{
  "nodes": {
    "characters": [{ "name", "description", "quote" }],
    "events": [...],
    "themes": [...],
    "symbols": [...]
  },
  "edges": [...]
}
```

匯入時由 `normalizeIncomingGraph` 轉成 flat 契約。

---

## 三、語意去重管線

1. Embedding：主題「名稱 + 解釋」向量化  
2. Vector Search：查詢全域 Theme／Symbol  
3. 閾值 ≥ 0.85 → 連到既有 canonical 節點；否則新建  
4. Alias：邊或節點保留 `originalTerm`／`aliases`  

---

## 四、長文本 Map-Reduce

1. **切片**：`TextChunkingService`（章／空行／句末，max≈3000）  
2. **Map**：Context／Entity／Style Agent 並行（可先合併為單 Agent）  
3. **Reduce**：Entity Merging + Theme Clustering  
4. **驗證**：Hallucination Checker（引文必須出現在原文）  
5. **編譯**：Graph Compiler → Neo4j  

---

## 五、後端服務（Spring Boot）

正式目錄：`backend/`（Maven 打包後可替換 Node `server/`，同埠 **8787**）

- `TextChunkingService`：語意邊界切片  
- `JsonSanitizerService`：防禦性 JSON 解析  
- `DedupService` + `EmbeddingService`：主題／象徵去重  
- `QuoteVerificationService`：引文驗證  
- `AnalysisOrchestrator`：Map-Reduce 全管線  
- `WorkStoreService` + `Neo4jGraphService`：作品庫與圖寫入  

```bash
cd backend
./mvnw -DskipTests package   # 或 mvn
java -jar target/novel-map-backend-0.1.0.jar
# 或 backend/run.cmd
```

---

## 六、Neo4j 寫入原則

- `Work` / `Chapter` / `Character` / `Event` / `Theme` / `Symbol`  
- 以 **canonicalId**（非顯示名）做 `MERGE` 鍵，避免同名異義  
- Theme 跨作品 `(:Work)-[:EXPLORES]->(:Theme)`  
- 保留 `originalTerm` 於關係或屬性  

範例見 `backend/cypher/upsert-chapter.cypher`。

---

## 七、前端映射

| 欄位 | 說明 |
|------|------|
| `node.id` | 唯一 id |
| `node.type` | Character／Event／Theme／Symbol → 不同色環 |
| `node.data` | label、summary、evidence |
| 佈局 | 星系：主題→角色→事件→象徵 |

---

## 八、實作階段

| Phase | 內容 | 狀態 |
|-------|------|------|
| A | 四維度契約 + 星系前端 + 匯入／LLM | ✅ |
| B | 切片 + sanitizer + Map-Reduce 後端 + 引文檢查 + 作品庫 | ✅（`server/` 與 `backend/` Spring JAR 皆可替換跑於 8787） |
| C | Embedding 向量去重（閾值 0.85；memory／Qdrant／Pinecone） | ✅（Node 全後端；Spring：memory + OpenAI embeddings） |
| D | Neo4j 正式寫入 + 作家地圖可讀 Neo4j | ✅（Node／Spring 皆可；需本機 Neo4j） |
| E | 完整作家心靈地圖 UI（星系中心＝作者） | 規劃中 |
