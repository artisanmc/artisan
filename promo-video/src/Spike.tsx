import "@/i18n";
import { Stage } from "@/features/canvas/Stage";
import { useTextureStore } from "@/features/canvas/textureStore";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { AbsoluteFill } from "remotion";
import items from "../../backend/data/items/1.21.4.json";
import { DEMO_PROJECT_ID, demoProject } from "./project";

const project = demoProject();
useAccountStore.setState({
  account: { id: "a_demo" as never, projects: [project], projectOrder: [project.id] },
});
useTextureStore.getState().setData("1.21.4", items);
useSelectionStore.getState().set(["shop"]);
useUiStore.setState({ minimapVisible: false, canvasViewports: { [DEMO_PROJECT_ID]: { x: 360, y: 260, scale: 0.55 } } });

export function Spike() {
  return (
    <AbsoluteFill style={{ background: "var(--surface)" }}>
      <Stage projectId={DEMO_PROJECT_ID} />
    </AbsoluteFill>
  );
}
