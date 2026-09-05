# Neo4j 正式寫入

分析／匯入作品時，若 `NEO4J_ENABLED=true`，會把 `NovelGraph` MERGE 進 Neo4j。

## 資料模型

| Label | 鍵 | 說明 |
|-------|-----|------|
| `Work` | `id` | 作品 |
| `Character` / `Event` / `Theme` / `Symbol` | `id` | 分析節點（Theme 可跨作品共用） |
| `CONTAINS` | Work→節點 | 本篇收錄 |
| `EXPLORES` | Work→Theme | 跨篇主題聚合用 |
| `RELATES` | 節點→節點 | 通用分析邊（`type` 屬性） |
| `EMBODIES` 等 | 節點→節點 | 同義 typed 邊（查詢友善） |

## 啟動 Neo4j

### Docker（需已安裝 Docker）

```bash
cd C:\Temp\novel-map-app
docker compose up -d
```

Browser：http://localhost:7474 （neo4j / password）

### Neo4j Desktop

建立 local DBMS，密碼設成與 `.env` 一致，啟用 Bolt `7687`。

## 伺服器設定

`server/.env`：

```env
NEO4J_ENABLED=true
NEO4J_URI=bolt://127.0.0.1:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password
```

重啟：

```bash
cd C:\Temp\novel-map-app\server
npm run dev
```

`GET /api/health` 應見 `"neo4j": { "enabled": true, "connected": true }`。

## API

| 方法 | 路徑 | 說明 |
|------|------|------|
| GET | `/api/neo4j/status` | 連線狀態 |
| POST | `/api/neo4j/sync` | body: `{ graph }` 寫入單篇 |
| POST | `/api/neo4j/sync-all` | 把本地作品庫全部同步 |
| GET | `/api/author-map?source=neo4j` | 從 Neo4j 聚合主題 |

一般 `PUT /api/works`、`POST /api/analyze` 在啟用時會自動雙寫（JSON + Neo4j）。
