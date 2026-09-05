# Embedding 語意去重

Map-Reduce 合併後，對 Theme／Symbol 執行：

1. `label + summary` → OpenAI Embeddings（預設 `text-embedding-3-small`）  
2. 批次內餘弦相似度 ≥ **0.85** → 併入既有 canonical  
3. 可選查詢／寫入全域向量庫（跨作品對齊）  
4. 邊保留 `originalTerm`（原詞）

## 環境變數

見 `.env.example`。

| 變數 | 說明 |
|------|------|
| `DEDUP_THRESHOLD` | 預設 `0.85` |
| `VECTOR_BACKEND` | `memory`（預設）／`qdrant`／`pinecone` |
| `EMBEDDING_MODEL` | 預設 `text-embedding-3-small` |

## API

```http
POST /api/dedup
{
  "candidates": [
    { "id": "n1", "label": "孤獨", "summary": "…", "type": "Theme" },
    { "id": "n2", "label": "孤寂", "summary": "…", "type": "Theme" }
  ],
  "apiKey": "sk-…",
  "threshold": 0.85,
  "mode": "embedding"
}
```

無 `apiKey` 時自動回退 Jaccard。

## 健康檢查

`GET /api/health` 會回傳目前 `dedup.threshold` 與 `vectorBackend`。
