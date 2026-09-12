import { useUiStore } from "@/state/uiStore";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CanvasMinimap } from "./CanvasMinimap";

it("closes without moving the viewport", () => {
  const onNavigate = vi.fn();
  useUiStore.setState({ minimapVisible: true });
  render(
    <CanvasMinimap
      boxes={[]}
      size={{ w: 400, h: 200 }}
      viewport={{ x: 0, y: 0, scale: 1 }}
      onNavigate={onNavigate}
    />,
  );
  const close = screen.getByRole("button", { name: /close minimap|fermer la minimap/i });
  fireEvent.pointerDown(close);
  fireEvent.click(close);
  expect(useUiStore.getState().minimapVisible).toBe(false);
  expect(onNavigate).not.toHaveBeenCalled();
});

it("drags the visible rectangle without jumping and stops on release", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const onNavigate = vi.fn();
  render(
    <CanvasMinimap
      boxes={[{ id: "menu", x: 0, y: 0, width: 1000, height: 600 }]}
      size={{ w: 400, h: 200 }}
      viewport={{ x: 0, y: 0, scale: 2 }}
      onNavigate={onNavigate}
    />,
  );
  const map = screen.getByRole("application");
  vi.spyOn(map, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 220,
    height: 140,
  } as DOMRect);
  fireEvent.pointerDown(map, { clientX: 20, clientY: 20, button: 0 });
  expect(onNavigate).not.toHaveBeenCalled();
  fireEvent.pointerMove(map, { clientX: 42, clientY: 31 });
  expect(onNavigate).toHaveBeenLastCalledWith({ x: -216, y: -108, scale: 2 });
  fireEvent.pointerUp(map);
  onNavigate.mockClear();
  fireEvent.pointerMove(map, { clientX: 60, clientY: 50 });
  expect(onNavigate).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

it("centers the viewport on a clicked map position without changing zoom", () => {
  const onNavigate = vi.fn();
  render(
    <CanvasMinimap
      boxes={[{ id: "menu", x: 0, y: 0, width: 1000, height: 600 }]}
      size={{ w: 400, h: 200 }}
      viewport={{ x: 0, y: 0, scale: 2 }}
      onNavigate={onNavigate}
    />,
  );
  const map = screen.getByRole("application");
  vi.spyOn(map, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 220,
    height: 140,
  } as DOMRect);
  vi.stubGlobal("PointerEvent", MouseEvent);
  fireEvent.pointerDown(map, { clientX: 110, clientY: 70, button: 0 });
  expect(onNavigate).toHaveBeenLastCalledWith({ x: -800, y: -500, scale: 2 });
  vi.unstubAllGlobals();
});
