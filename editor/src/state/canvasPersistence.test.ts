import type { ProjectId } from "@/domain/types";
import { expect, it } from "vitest";
import { useUiStore } from "./uiStore";

it("restores each project's position and zoom after rehydration", async () => {
  const a = { x: -420, y: 180, scale: 0.6 };
  const b = { x: 90, y: -20, scale: 2 };
  useUiStore.getState().setCanvasViewport("a" as ProjectId, a);
  useUiStore.getState().setCanvasViewport("b" as ProjectId, b);
  const saved = localStorage.getItem("artisan:ui")!;
  useUiStore.setState({ canvasViewports: {} });
  localStorage.setItem("artisan:ui", saved);
  await useUiStore.persist.rehydrate();
  expect(useUiStore.getState().canvasViewports).toMatchObject({ a, b });
});

it("remembers whether the minimap was hidden", async () => {
  useUiStore.getState().setMinimapVisible(false);
  const saved = localStorage.getItem("artisan:ui")!;
  useUiStore.setState({ minimapVisible: true });
  localStorage.setItem("artisan:ui", saved);
  await useUiStore.persist.rehydrate();
  expect(useUiStore.getState().minimapVisible).toBe(false);
});
