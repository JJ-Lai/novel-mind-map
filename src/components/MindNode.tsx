import {
  memo,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  Handle,
  Position,
  type NodeProps,
  type Node,
} from "@xyflow/react";
import { NODE_TYPE_META, type GraphNode, type NodeType } from "../lib/schema";

export type MindNodeData = {
  graphNode: GraphNode;
  selected?: boolean;
  kind?: "hub" | "orbit";
  hubTitle?: string;
};

export type MindFlowNode = Node<MindNodeData, "mind">;

function MindNodeComponent({ data }: NodeProps<MindFlowNode>) {
  if (data.kind === "hub") {
    return (
      <div className={`mind-hub${data.selected ? " is-selected" : ""}`}>
        <Handle type="target" position={Position.Top} className="mind-handle" />
        <Handle
          type="source"
          position={Position.Bottom}
          className="mind-handle"
        />
        <Handle type="source" position={Position.Left} className="mind-handle" />
        <Handle
          type="source"
          position={Position.Right}
          className="mind-handle"
        />
        <div className="mind-hub__eyebrow">作品核心</div>
        <div className="mind-hub__title">{data.hubTitle ?? "未命名"}</div>
      </div>
    );
  }

  const n = data.graphNode;
  const meta = NODE_TYPE_META[n.type as NodeType];
  const style: CSSProperties = {
    background: meta.bg,
    borderColor: meta.color,
    color: meta.text,
    boxShadow: data.selected
      ? `0 0 0 3px ${meta.color}66, 0 10px 28px rgba(28, 22, 16, 0.16)`
      : `0 6px 18px ${meta.color}33`,
  };

  return (
    <div className="mind-node" style={style} data-type={n.type}>
      <span className="mind-node__bar" style={{ background: meta.color }} />
      <Handle type="target" position={Position.Left} className="mind-handle" />
      <Handle type="target" position={Position.Top} className="mind-handle" />
      <div className="mind-node__type" style={{ background: meta.color }}>
        {meta.label}
      </div>
      <div className="mind-node__label">{n.label}</div>
      <Handle type="source" position={Position.Right} className="mind-handle" />
      <Handle type="source" position={Position.Bottom} className="mind-handle" />
    </div>
  );
}

export const MindNode = memo(MindNodeComponent);

export function Panel({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <h2 className="panel__title">{title}</h2>
      {children}
    </section>
  );
}
