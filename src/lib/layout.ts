import type { NodeType, NovelGraph } from "./schema";

export type LayoutPoint = { x: number; y: number };

export const HUB_NODE_ID = "__doc_hub__";

/** 由內而外：主題 → 角色 → 事件 → 象徵 */
const RING_ORDER: NodeType[] = ["Theme", "Character", "Event", "Symbol"];

const RING_RADIUS: Record<NodeType, number> = {
  Theme: 240,
  Character: 400,
  Event: 560,
  Symbol: 720,
};

const HUB_SIZE = { w: 160, h: 88 };
const NODE_SIZE = { w: 168, h: 64 };

function degreeMap(graph: NovelGraph): Map<string, number> {
  const deg = new Map<string, number>();
  for (const n of graph.nodes) deg.set(n.id, 0);
  for (const e of graph.edges) {
    deg.set(e.from, (deg.get(e.from) ?? 0) + 1);
    deg.set(e.to, (deg.get(e.to) ?? 0) + 1);
  }
  return deg;
}

/**
 * 星系佈局：作品標題在中心，四維度沿同心圓向外展開。
 */
export function layoutGalaxy(graph: NovelGraph): Record<string, LayoutPoint> {
  const cx = 0;
  const cy = 0;
  const positions: Record<string, LayoutPoint> = {};

  positions[HUB_NODE_ID] = {
    x: cx - HUB_SIZE.w / 2,
    y: cy - HUB_SIZE.h / 2,
  };

  const deg = degreeMap(graph);
  const byType = new Map<NodeType, string[]>();
  for (const t of RING_ORDER) byType.set(t, []);
  for (const n of graph.nodes) {
    const list = byType.get(n.type) ?? [];
    list.push(n.id);
    byType.set(n.type, list);
  }

  const themeIds = [...(byType.get("Theme") ?? [])].sort(
    (a, b) => (deg.get(b) ?? 0) - (deg.get(a) ?? 0) || a.localeCompare(b)
  );
  const themeAngle = new Map<string, number>();
  themeIds.forEach((id, i) => {
    const angle =
      themeIds.length === 1
        ? -Math.PI / 2
        : (Math.PI * 2 * i) / themeIds.length - Math.PI / 2;
    themeAngle.set(id, angle);
    const r = RING_RADIUS.Theme;
    positions[id] = {
      x: cx + Math.cos(angle) * r - NODE_SIZE.w / 2,
      y: cy + Math.sin(angle) * r - NODE_SIZE.h / 2,
    };
  });

  const neighbors = new Map<string, string[]>();
  for (const n of graph.nodes) neighbors.set(n.id, []);
  for (const e of graph.edges) {
    neighbors.get(e.from)?.push(e.to);
    neighbors.get(e.to)?.push(e.from);
  }

  for (const type of RING_ORDER) {
    if (type === "Theme") continue;
    const ids = [...(byType.get(type) ?? [])].sort(
      (a, b) => (deg.get(b) ?? 0) - (deg.get(a) ?? 0) || a.localeCompare(b)
    );
    if (!ids.length) continue;

    const preferred = ids.map((id, idx) => {
      const nb = neighbors.get(id) ?? [];
      const placedAngles = nb
        .map((oid) => {
          const p = positions[oid];
          if (!p) return null;
          return Math.atan2(
            p.y + NODE_SIZE.h / 2 - cy,
            p.x + NODE_SIZE.w / 2 - cx
          );
        })
        .filter((a): a is number => a != null);

      let angle: number;
      if (placedAngles.length) {
        const sx = placedAngles.reduce((s, a) => s + Math.cos(a), 0);
        const sy = placedAngles.reduce((s, a) => s + Math.sin(a), 0);
        angle = Math.atan2(sy, sx);
      } else {
        angle = (Math.PI * 2 * idx) / ids.length - Math.PI / 2;
      }
      return { id, angle };
    });

    preferred.sort((a, b) => a.angle - b.angle);
    const minGap = (Math.PI * 2) / Math.max(ids.length, 6);
    for (let i = 1; i < preferred.length; i++) {
      const prev = preferred[i - 1].angle;
      if (preferred[i].angle - prev < minGap) {
        preferred[i].angle = prev + minGap;
      }
    }
    const span =
      preferred.length > 1
        ? preferred[preferred.length - 1].angle - preferred[0].angle
        : 0;
    if (span > Math.PI * 2 - minGap * 0.5) {
      preferred.forEach((item, i) => {
        item.angle = (Math.PI * 2 * i) / preferred.length - Math.PI / 2;
      });
    }

    const baseR = RING_RADIUS[type];
    preferred.forEach((item, i) => {
      const jitter = ((i % 3) - 1) * 18;
      const r = baseR + jitter;
      positions[item.id] = {
        x: cx + Math.cos(item.angle) * r - NODE_SIZE.w / 2,
        y: cy + Math.sin(item.angle) * r - NODE_SIZE.h / 2,
      };
    });
  }

  void themeAngle;
  return positions;
}

export const layoutByType = layoutGalaxy;

export function galaxyRingRadii(): number[] {
  return RING_ORDER.map((t) => RING_RADIUS[t]);
}
