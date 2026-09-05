import { memo, useId } from "react";
import { useStore } from "@xyflow/react";
import { HUB_NODE_ID } from "../lib/layout";

type Props = {
  radii: number[];
};

/** 在畫布座標系繪製星系軌道圈（跟隨 pan/zoom 與中心節點拖曳）。 */
function OrbitGuidesInner({ radii }: Props) {
  const gradId = useId().replace(/:/g, "");
  const transform = useStore((s) => s.transform);
  const nodes = useStore((s) => s.nodes);
  const hub = nodes.find((n) => n.id === HUB_NODE_ID);

  const [tx, ty, zoom] = transform;
  const hx = (hub?.position.x ?? -80) + 80;
  const hy = (hub?.position.y ?? -44) + 44;

  return (
    <svg className="orbit-guides" aria-hidden>
      <g transform={`translate(${tx} ${ty}) scale(${zoom})`}>
        <defs>
          <radialGradient id={`galaxy-glow-${gradId}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#d4a574" stopOpacity="0.38" />
            <stop offset="50%" stopColor="#c4a882" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#c4a882" stopOpacity="0" />
          </radialGradient>
        </defs>
        <circle cx={hx} cy={hy} r={170} fill={`url(#galaxy-glow-${gradId})`} />
        {radii.map((r) => (
          <circle
            key={r}
            className="orbit-guides__ring"
            cx={hx}
            cy={hy}
            r={r}
            fill="none"
          />
        ))}
      </g>
    </svg>
  );
}

export const OrbitGuides = memo(OrbitGuidesInner);
