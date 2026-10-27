import { deriveEdges } from "@/features/canvas/deriveEdges";
import { demoProject } from "./project";

export function Debug() {
  const p = demoProject();
  const edges = deriveEdges(p);
  return (
    <pre style={{ color: "white", fontSize: 14, background: "black", width: "100%", height: "100%" }}>
      {JSON.stringify({ layout: p.canvasLayout, edges: edges.map((e) => [e.source, e.target, e.kind]) , menus: p.menus.map(m=>[m.id, m.rows, m.playerInventory])}, null, 1)}
    </pre>
  );
}
