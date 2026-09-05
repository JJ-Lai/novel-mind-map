import { useEffect, useMemo } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  MarkerType,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  EDGE_TYPE_LABEL,
  NODE_TYPE_META,
  type GraphNode,
  type NovelGraph,
} from "../lib/schema";
import { galaxyRingRadii, HUB_NODE_ID, layoutGalaxy } from "../lib/layout";
import { MindNode, type MindFlowNode } from "./MindNode";
import { OrbitGuides } from "./OrbitGuides";

const nodeTypes = { mind: MindNode };

const EDGE_COLORS: Record<string, string> = {
  embodies: "#c0392b",
  causes: "#2f5fad",
  contrasts_with: "#8e3db8",
  uses: "#2a8a9a",
  recurs_in: "#c47a12",
  evolves_into: "#1e7a5f",
  related_to: "#8a7663",
  participates_in: "#5a8a2f",
};

type Props = {
  graph: NovelGraph;
  selectedId: string | null;
  onSelect: (node: GraphNode | null) => void;
};

function MindMapCanvasInner({ graph, selectedId, onSelect }: Props) {
  const { fitView } = useReactFlow();

  const built = useMemo(() => {
    const positions = layoutGalaxy(graph);

    const hubNode: MindFlowNode = {
      id: HUB_NODE_ID,
      type: "mind",
      position: positions[HUB_NODE_ID] ?? { x: -80, y: -44 },
      data: {
        graphNode: {
          id: HUB_NODE_ID,
          type: "Theme",
          label: graph.document.title,
          source: "user",
          summary: "作品標題（星系核心）",
        },
        kind: "hub",
        hubTitle: graph.document.title,
        selected: selectedId === HUB_NODE_ID,
      },
      draggable: true,
      zIndex: 20,
    };

    const orbitNodes: MindFlowNode[] = graph.nodes.map((n) => ({
      id: n.id,
      type: "mind",
      position: positions[n.id] ?? { x: 0, y: 0 },
      data: { graphNode: n, kind: "orbit", selected: n.id === selectedId },
    }));

    const themes = graph.nodes.filter((n) => n.type === "Theme");
    const topChars = graph.nodes
      .filter((n) => n.type === "Character")
      .slice(0, 3);
    const spokeTargets = [...themes, ...topChars];

    const spokeEdges: Edge[] = spokeTargets.map((n) => {
      const related =
        selectedId == null ||
        selectedId === HUB_NODE_ID ||
        selectedId === n.id;
      return {
        id: `spoke_${n.id}`,
        source: HUB_NODE_ID,
        target: n.id,
        type: "default",
        selectable: false,
        style: {
          stroke: "#b08968",
          strokeWidth: selectedId === HUB_NODE_ID ? 2 : 1.2,
          strokeDasharray: "5 6",
          opacity: related ? 0.55 : 0.12,
        },
        zIndex: 0,
      };
    });

    const edges: Edge[] = graph.edges.map((e) => {
      const relatedToSelected =
        selectedId != null &&
        (e.from === selectedId ||
          e.to === selectedId ||
          selectedId === HUB_NODE_ID);
      const dimmed =
        selectedId != null &&
        selectedId !== HUB_NODE_ID &&
        e.from !== selectedId &&
        e.to !== selectedId;
      const stroke = EDGE_COLORS[e.type] ?? "#8a7663";

      return {
        id: e.id,
        source: e.from,
        target: e.to,
        type: "default",
        label: relatedToSelected
          ? e.label ?? EDGE_TYPE_LABEL[e.type]
          : undefined,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: stroke,
        },
        style: {
          stroke,
          strokeWidth: relatedToSelected ? 2.4 : 1.35,
          opacity: dimmed ? 0.14 : 0.72,
        },
        labelStyle: { fill: "#3d3228", fontSize: 11, fontWeight: 600 },
        labelBgStyle: { fill: "#fffaf2", fillOpacity: 0.95 },
        labelBgPadding: [5, 7] as [number, number],
        labelBgBorderRadius: 4,
        zIndex: relatedToSelected ? 8 : 1,
      };
    });

    return {
      nodes: [hubNode, ...orbitNodes],
      edges: [...spokeEdges, ...edges],
      rings: galaxyRingRadii(),
    };
  }, [graph, selectedId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(built.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(built.edges);

  useEffect(() => {
    setNodes(built.nodes);
    setEdges(built.edges);
  }, [built, setNodes, setEdges]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      fitView({ padding: 0.22, duration: 200 });
    }, 80);
    return () => window.clearTimeout(t);
  }, [graph.document.id, fitView, nodes.length]);

  return (
    <div className="canvas-wrap canvas-wrap--galaxy">
      <div className="canvas-hint">
        星系圖譜：中央為作品標題，向外依 主題 → 角色 → 事件 → 象徵
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.22 }}
        minZoom={0.12}
        maxZoom={1.8}
        nodesDraggable
        onNodeClick={(_, node) => {
          const gn = (node.data as MindFlowNode["data"]).graphNode;
          onSelect(gn);
        }}
        onPaneClick={() => onSelect(null)}
        proOptions={{ hideAttribution: true }}
      >
        <OrbitGuides radii={built.rings} />
        <Background gap={36} color="#cfc0a8" />
        <Controls />
        <MiniMap
          nodeColor={(n) => {
            if (n.id === HUB_NODE_ID) return "#8b5a2b";
            const t = (n.data as MindFlowNode["data"])?.graphNode?.type;
            return t ? NODE_TYPE_META[t].color : "#888";
          }}
          maskColor="rgba(40,30,20,0.12)"
        />
      </ReactFlow>
    </div>
  );
}

export function MindMapCanvas(props: Props) {
  return (
    <ReactFlowProvider>
      <MindMapCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
