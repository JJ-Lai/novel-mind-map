import {
  EDGE_TYPE_LABEL,
  NODE_TYPE_META,
  type GraphNode,
  type NovelGraph,
} from "../lib/schema";
import { HUB_NODE_ID } from "../lib/layout";

type Props = {
  graph: NovelGraph;
  node: GraphNode | null;
};

export function DetailPanel({ graph, node }: Props) {
  if (!node) {
    return (
      <div className="detail detail--empty">
        <p>點選節點以查看摘要、引用與相鄰關係。</p>
        <ul className="legend">
          {Object.entries(NODE_TYPE_META).map(([k, v]) => (
            <li key={k}>
              <span
                className="swatch"
                style={{ background: v.color, boxShadow: `0 0 0 3px ${v.bg}` }}
              />
              {v.label}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (node.id === HUB_NODE_ID) {
    return (
      <div className="detail">
        <div className="detail__type" style={{ color: "#8b5a2b" }}>
          星系核心
        </div>
        <h3>{node.label}</h3>
        <p>
          以此作品標題為中心，外圈依類型展開。虛線為核心輻射（連至主題／主要人物），實線為文本內分析關係。
        </p>
        <p className="muted">
          {graph.nodes.length} 個分析節點 · {graph.edges.length} 條關係
        </p>
      </div>
    );
  }

  const related = graph.edges.filter(
    (e) => e.from === node.id || e.to === node.id
  );
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));

  return (
    <div className="detail">
      <div
        className="detail__type"
        style={{ color: NODE_TYPE_META[node.type].color }}
      >
        {NODE_TYPE_META[node.type].label}
      </div>
      <h3>{node.label}</h3>
      {node.aliases?.length ? (
        <p className="muted">別名：{node.aliases.join("、")}</p>
      ) : null}
      {node.summary ? <p>{node.summary}</p> : null}
      {node.confidence != null ? (
        <p className="muted">信心：{(node.confidence * 100).toFixed(0)}%</p>
      ) : null}
      {node.unverified ? (
        <p className="warn">未驗證（無可靠原文引用）</p>
      ) : null}

      {node.evidence?.length ? (
        <div className="block">
          <h4>原文引用</h4>
          {node.evidence.map((ev, i) => (
            <blockquote key={i}>「{ev.quote}」</blockquote>
          ))}
        </div>
      ) : null}

      <div className="block">
        <h4>相鄰關係（{related.length}）</h4>
        <ul className="rel-list">
          {related.map((e) => {
            const otherId = e.from === node.id ? e.to : e.from;
            const other = byId.get(otherId);
            const dir = e.from === node.id ? "→" : "←";
            return (
              <li key={e.id}>
                <span className="rel-type">{EDGE_TYPE_LABEL[e.type]}</span>
                <span>
                  {dir} {other?.label ?? otherId}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
