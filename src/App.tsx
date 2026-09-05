import { useCallback, useEffect, useRef, useState } from "react";
import { MindMapCanvas } from "./components/MindMapCanvas";
import { DetailPanel } from "./components/DetailPanel";
import { Panel } from "./components/MindNode";
import {
  downloadGraph,
  parseGraphJsonText,
  type ValidationIssue,
} from "./lib/ingest";
import { analyzeWithOpenAI } from "./lib/llm";
import {
  analyzeOnServer,
  fetchAuthorMap,
  fetchWork,
  healthCheck,
  listWorks,
  saveWork,
} from "./lib/api";
import type { GraphNode, NovelGraph } from "./lib/schema";

const STORAGE_KEY = "novel-map.currentGraph.v2";
const KEY_STORAGE = "novel-map.apiKey";

type WorkMeta = { id: string; title: string; author: string | null; updatedAt: string };

export default function App() {
  const [graph, setGraph] = useState<NovelGraph | null>(null);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [issues, setIssues] = useState<ValidationIssue[]>([]);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [serverOk, setServerOk] = useState(false);
  const [neo4jOk, setNeo4jOk] = useState(false);
  const [useServerPipeline, setUseServerPipeline] = useState(true);
  const [works, setWorks] = useState<WorkMeta[]>([]);
  const [authorThemes, setAuthorThemes] = useState<
    Array<{ label: string; count: number; workIds: string[] }>
  >([]);
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem(KEY_STORAGE) ?? ""
  );
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [model, setModel] = useState("gpt-4o-mini");
  const [title, setTitle] = useState("降神");
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const applyGraph = useCallback((g: NovelGraph, msg: string) => {
    setGraph(g);
    setSelected(null);
    setIssues([]);
    setStatus(msg);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(g));
  }, []);

  const refreshWorks = useCallback(async () => {
    if (!serverOk) return;
    try {
      const { works: list } = await listWorks();
      setWorks(list);
      const am = await fetchAuthorMap(null);
      setAuthorThemes(am.signatureThemes.slice(0, 8));
    } catch {
      /* ignore */
    }
  }, [serverOk]);

  useEffect(() => {
    void (async () => {
      const h = await healthCheck();
      setServerOk(h.ok);
      setNeo4jOk(Boolean(h.neo4j?.enabled && h.neo4j?.connected));
      if (h.ok) {
        const neo = h.neo4j?.enabled
          ? h.neo4j.connected
            ? "Neo4j 已連線"
            : "Neo4j 未連線"
          : "Neo4j 關閉";
        setStatus(`後端已連線（${h.service ?? "ok"}）· ${neo}`);
      }
    })();
  }, []);

  useEffect(() => {
    void refreshWorks();
  }, [refreshWorks]);

  useEffect(() => {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) {
      const result = parseGraphJsonText(cached);
      if (result.ok) {
        setGraph(result.graph);
        setStatus((s) => s || "已還原上次工作階段");
        return;
      }
    }
    void loadSample();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSample() {
    setBusy(true);
    setStatus("載入《降神》示範圖譜…");
    try {
      const [graphRes, textRes] = await Promise.all([
        fetch("/samples/jiangshen.graph.json"),
        fetch("/samples/jiangshen.txt"),
      ]);
      const raw = await graphRes.json();
      const body = await textRes.text();
      const result = parseGraphJsonText(JSON.stringify(raw));
      if (!result.ok) {
        setIssues(result.issues);
        setStatus("示範圖譜驗證失敗");
        return;
      }
      setText(body);
      setTitle("降神");
      applyGraph(result.graph, "已載入《降神》示範圖譜（人工整理）");
      if (serverOk) {
        try {
          await saveWork(result.graph);
          await refreshWorks();
        } catch {
          /* optional */
        }
      }
    } catch (e) {
      setStatus(`載入失敗：${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function onImportFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const result = parseGraphJsonText(String(reader.result ?? ""));
      if (!result.ok) {
        setIssues(result.issues);
        setStatus(`匯入失敗：${file.name}`);
        return;
      }
      applyGraph(result.graph, `已匯入：${file.name}`);
      if (serverOk) {
        void saveWork(result.graph).then(() => refreshWorks());
      }
    };
    reader.readAsText(file, "utf-8");
  }

  async function onAnalyze() {
    if (!apiKey.trim()) {
      setStatus("請先填入 API Key，或改用匯入 JSON／示範圖譜");
      return;
    }
    if (!text.trim()) {
      setStatus("請貼上或載入小說文本");
      return;
    }
    localStorage.setItem(KEY_STORAGE, apiKey.trim());
    setBusy(true);
    setIssues([]);

    if (useServerPipeline && serverOk) {
      setStatus("後端 Map-Reduce 分析中（切片→抽取→去重→引文驗證）…");
      try {
        const result = await analyzeOnServer({
          title,
          text,
          apiKey: apiKey.trim(),
          baseUrl,
          model,
        });
        const parsed = parseGraphJsonText(JSON.stringify(result.graph));
        if (!parsed.ok) {
          setIssues(parsed.issues);
          setStatus("後端回傳未通過前端 schema");
        } else {
          const phases = (result.progress ?? [])
            .map((p) => p.phase)
            .filter(Boolean);
          applyGraph(
            parsed.graph,
            `伺服器分析完成（${model}）· 階段：${phases.join(" → ") || "done"}`
          );
          await refreshWorks();
        }
      } catch (e) {
        setStatus(`伺服器分析失敗：${String(e)}；可改勾「瀏覽器直連」重試`);
      } finally {
        setBusy(false);
      }
      return;
    }

    setStatus("瀏覽器直連 LLM 分析中…");
    const result = await analyzeWithOpenAI({
      apiKey: apiKey.trim(),
      baseUrl,
      model,
      title,
      text,
    });
    setBusy(false);
    if (!result.ok) {
      setStatus(result.error);
      return;
    }
    applyGraph(result.graph, `LLM 分析完成（${model}）`);
    if (serverOk) {
      void saveWork(result.graph).then(() => refreshWorks());
    }
  }

  async function openWork(id: string) {
    setBusy(true);
    try {
      const { work } = await fetchWork(id);
      const parsed = parseGraphJsonText(JSON.stringify(work.graph));
      if (!parsed.ok) {
        setIssues(parsed.issues);
        setStatus("作品圖譜驗證失敗");
        return;
      }
      setTitle(parsed.graph.document.title);
      applyGraph(parsed.graph, `已開啟作品：${work.title}`);
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="hero">
        <div className="hero__brand">小說地圖</div>
        <p className="hero__tag">
          藍圖全抄：單篇解構＋Map-Reduce＋去重＋作家主題聚合。契約{" "}
          <code>2.0.0</code>
          {" · "}
          <span className={serverOk ? "pill ok" : "pill bad"}>
            後端 {serverOk ? "連線中" : "未連線"}
          </span>
          {" · "}
          <span className={neo4jOk ? "pill ok" : "pill bad"}>
            Neo4j {neo4jOk ? "寫入中" : "未啟用"}
          </span>
        </p>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <Panel title="文本">
            <label className="field">
              <span>標題</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="field">
              <span>正文</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={8}
                placeholder="貼上小說文本，或載入示範《降神》"
                disabled={busy}
              />
            </label>
            <div className="btn-row">
              <button type="button" onClick={() => void loadSample()} disabled={busy}>
                載入《降神》示範
              </button>
            </div>
          </Panel>

          <Panel title="圖譜來源">
            <div className="btn-row">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
              >
                匯入 JSON
              </button>
              <button
                type="button"
                disabled={!graph || busy}
                onClick={() => graph && downloadGraph(graph)}
              >
                匯出 JSON
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onImportFile(f);
                  e.target.value = "";
                }}
              />
            </div>
            <p className="hint">
              外部 Agent：<code>specs/AGENT_PROMPT.md</code>（schema{" "}
              <code>2.0.0</code>）
            </p>
          </Panel>

          <Panel title="LLM／後端管線">
            <label className="field">
              <span>API Key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-…"
                disabled={busy}
                autoComplete="off"
              />
            </label>
            <label className="field">
              <span>Base URL</span>
              <input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="field">
              <span>Model</span>
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={useServerPipeline}
                onChange={(e) => setUseServerPipeline(e.target.checked)}
                disabled={!serverOk || busy}
              />
              使用後端 Map-Reduce（切片／去重／引文驗證）
            </label>
            <div className="btn-row">
              <button
                type="button"
                className="primary"
                onClick={() => void onAnalyze()}
                disabled={busy}
              >
                {busy ? "處理中…" : "分析並產生圖譜"}
              </button>
            </div>
            <p className="hint">
              後端預設 <code>http://127.0.0.1:8787</code>；未連線時可改瀏覽器直連。
            </p>
          </Panel>

          {serverOk ? (
            <Panel title="作品庫">
              {works.length === 0 ? (
                <p className="muted">尚無儲存作品</p>
              ) : (
                <ul className="work-list">
                  {works.map((w) => (
                    <li key={w.id}>
                      <button
                        type="button"
                        className="linkish"
                        disabled={busy}
                        onClick={() => void openWork(w.id)}
                      >
                        {w.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ) : null}

          {serverOk && authorThemes.length > 0 ? (
            <Panel title="作家主題（跨篇）">
              <ul className="theme-freq">
                {authorThemes.map((t) => (
                  <li key={t.label}>
                    <strong>{t.label}</strong>
                    <span className="muted">
                      {" "}
                      ×{t.count} · {t.workIds.length} 篇
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {status ? <p className="status">{status}</p> : null}
          {issues.length > 0 ? (
            <div className="issues">
              <h3>驗證錯誤</h3>
              <ul>
                {issues.map((i, idx) => (
                  <li key={idx}>
                    <code>{i.path}</code> {i.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>

        <main className="main">
          {graph ? (
            <>
              <div className="main__meta">
                <h1>{graph.document.title}</h1>
                <p>
                  {graph.nodes.length} 節點 · {graph.edges.length} 關係 · 來源{" "}
                  {graph.meta.producer.type}/{graph.meta.producer.name}
                </p>
              </div>
              <MindMapCanvas
                graph={graph}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
              />
            </>
          ) : (
            <div className="empty-main">尚未載入圖譜</div>
          )}
        </main>

        <aside className="inspector">
          <Panel title="節點詳情">
            {graph ? (
              <DetailPanel graph={graph} node={selected} />
            ) : (
              <p className="muted">無資料</p>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
