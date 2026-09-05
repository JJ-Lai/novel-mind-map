# 小說地圖 Spring Boot 後端

可替換 Node `server/` 的正式服務，預設 **http://127.0.0.1:8787**（與 Vite `/api` proxy 相同）。

## 需求

- JDK 21+
- Maven 3.9+（本機可用 `C:\Temp\apache-maven-3.9.6`）

## 編譯

```bash
cd backend
mvn -DskipTests package
```

產出：`target/novel-map-backend-0.1.0.jar`

## 啟動（替換 Node）

1. 停止 Node：關掉 `server` 的 `npm run dev`（佔用 8787）。
2. 啟動 Spring：

```bash
cd backend
java -jar target/novel-map-backend-0.1.0.jar
```

或開發模式：

```bash
mvn spring-boot:run
```

3. 確認：`GET http://127.0.0.1:8787/api/health` 應回 `"service":"novel-map-spring"`。

環境變數（與 Node 對齊）：

| 變數 | 說明 |
|------|------|
| `OPENAI_API_KEY` | 分析／embedding |
| `NEO4J_ENABLED` | `true` 啟用 |
| `NEO4J_URI` / `NEO4J_USER` / `NEO4J_PASSWORD` | Neo4j 連線 |

作品庫檔：`data/works.json`（相對啟動工作目錄）。

## API（與 Node 對齊）

| API | 說明 |
|-----|------|
| `GET /api/health` | 健康檢查 |
| `POST /api/chunk` | 文本切片 |
| `POST /api/sanitize` | JSON 防禦解析 |
| `POST /api/dedup` | 主題／象徵去重 |
| `POST /api/verify-quotes` | 引文驗證 |
| `POST /api/analyze` | Map-Reduce 全管線 |
| `GET/PUT/DELETE /api/works` | 作品庫 |
| `GET /api/author-map` | 跨篇主題聚合 |
| `GET /api/neo4j/status` | Neo4j 狀態 |
| `POST /api/neo4j/sync` · `sync-all` | 圖同步 |

前端無需改 URL：Vite 已 proxy `/api` → `8787`。
