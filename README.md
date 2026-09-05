# 小說地圖

依「小說文本分析與知識圖譜心智圖」**完整藍圖**開發。

- 四維度：`Character` / `Event` / `Theme` / `Symbol`（不含 Technique）  
- 契約：`schemaVersion: "2.0.0"`  
- 前端：星系心智圖 + JSON 匯入／匯出 + 後端 Map-Reduce  
- 可跑後端：`server/`（Node）  
- Spring 骨架：`backend/`（JDK 21 已可安裝；需 Maven 編譯）

## 啟動（兩端）

```bash
# 終端 1 — API
cd C:\Temp\novel-map-app\server
npm install
npm run dev

# 終端 2 — 前端
cd C:\Temp\novel-map-app
npm install
npm run dev
```

- 前端：http://127.0.0.1:5173  
- API：http://127.0.0.1:8787（Vite 已 proxy `/api`）

勾選「使用後端 Map-Reduce」並填 API Key，即可跑：切片 → 抽取 → 去重 → 引文驗證 → 存作品庫。

詳見 `specs/SPEC.md`、`backend/README.md`。
