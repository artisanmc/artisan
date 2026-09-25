import type { ProjectId } from "@/domain/types";
import { useTourPresentation } from "@/features/onboarding/tourPresentation";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/usePanelPresence", () => ({
  usePanelPresence: (open: boolean) => ({ mounted: open, expanded: open }),
}));

vi.mock("@/features/assets/useAssetInit", () => ({ useAssetInit: () => {} }));
vi.mock("@/features/canvas/useTextureInit", () => ({ useTextureInit: () => {} }));
vi.mock("@/features/canvas/Library", () => ({ Library: () => <div>Item catalogue</div> }));
vi.mock("@/features/assets/AssetsTab", () => ({ AssetsTab: () => <div>Captured catalogue</div> }));
vi.mock("@/features/canvas/CapturedItemsSection", () => ({
  CapturedItemsSection: () => <div>Captured catalogue</div>,
}));

import { ProjectLibraryButton, ProjectLibraryWorkspace } from "./ProjectLibrary";
import { useProjectLibraryStore } from "./projectLibraryStore";

const PID = "p1" as ProjectId;
it("shows the minimap button only when the minimap is closed", () => {
  useUiStore.setState({ minimapVisible: false });
  render(<Workspace />);
  const toggle = screen.getByRole("button", { name: /minimap/i });
  expect(toggle.parentElement).toBe(
    screen.getByRole("button", { name: /buttons|boutons/i }).parentElement,
  );
  fireEvent.click(toggle);
  expect(useUiStore.getState().minimapVisible).toBe(true);
  expect(screen.queryByRole("button", { name: /minimap/i })).toBeNull();
  act(() => useUiStore.getState().setMinimapVisible(false));
  fireEvent.click(screen.getByRole("button", { name: /buttons|boutons/i }));
  fireEvent.click(screen.getByRole("button", { name: /minimap/i }));
  expect(useUiStore.getState().minimapVisible).toBe(true);
  expect(screen.queryByRole("button", { name: /minimap/i })).toBeNull();
});
let desktop = true;
vi.mock("@/lib/useMediaQuery", () => ({ useIsDesktop: () => desktop }));

beforeEach(() => {
  useTourPresentation.setState({ step: null });
  desktop = true;
  useSelectionStore.getState().clear();
  useProjectLibraryStore.getState().close();
  useProjectLibraryStore.setState({ width: 340, height: 280, category: "items" });
});

it("temporarily presents Buttons for the tour without changing preferences or selection", () => {
  useSelectionStore.getState().set(["existing-element"]);
  const preferences = useProjectLibraryStore.getState();
  render(<Workspace />);
  act(() => useTourPresentation.setState({ step: 3 }));
  expect(screen.getByText("Item catalogue")).toBeInTheDocument();
  expect(useProjectLibraryStore.getState()).toBe(preferences);
  expect([...useSelectionStore.getState().ids]).toEqual(["existing-element"]);
  act(() => useTourPresentation.setState({ step: null }));
  expect(screen.queryByText("Item catalogue")).not.toBeInTheDocument();
  expect(useProjectLibraryStore.getState()).toBe(preferences);
});

function Workspace({ projectId = PID }: { projectId?: ProjectId }) {
  return (
    <>
      <ProjectLibraryWorkspace projectId={projectId}>
        <div>Canvas and properties</div>
      </ProjectLibraryWorkspace>
    </>
  );
}

it("hides the canvas tool while open and restores it after closing with the cross", async () => {
  render(<Workspace />);
  const button = screen.getByRole("button", { name: /boutons|buttons/i });
  await userEvent.click(button);
  expect(screen.queryByRole("button", { name: /^boutons$|^buttons$/i })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: /fermer les boutons|close buttons/i }));
  expect(screen.queryByText("Item catalogue")).toBeNull();
  expect(screen.getByRole("button", { name: /^boutons$|^buttons$/i })).toBeInTheDocument();
});

it("opens the project library without a selection, beside the existing workspace", async () => {
  const user = userEvent.setup();
  render(<Workspace />);
  expect(screen.queryByText("Item catalogue")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /boutons|buttons/i }));
  expect(screen.getByText("Item catalogue")).toBeInTheDocument();
  expect(screen.getByText("Canvas and properties")).toBeInTheDocument();
  expect(useSelectionStore.getState().ids.size).toBe(0);

  await user.click(screen.getByRole("tab", { name: /items capturés|captured items/i }));
  expect(screen.getByText("Captured catalogue")).toBeInTheDocument();

  act(() => useSelectionStore.getState().set(["command1"]));
  expect(screen.getByText("Captured catalogue")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /fermer les boutons|close buttons/i }));
  expect(screen.queryByText("Captured catalogue")).not.toBeInTheDocument();
  expect([...useSelectionStore.getState().ids]).toEqual(["command1"]);
});

it("hides the tool and an already open panel while the workspace is inactive", () => {
  const view = render(
    <ProjectLibraryWorkspace projectId={PID} active={false}>
      <div>Command view</div>
    </ProjectLibraryWorkspace>,
  );
  expect(screen.queryByRole("button", { name: /buttons|boutons/i })).toBeNull();
  act(() => useProjectLibraryStore.getState().open(PID));
  expect(screen.queryByText("Item catalogue")).toBeNull();
  expect(screen.getByText("Command view")).toBeInTheDocument();
  view.rerender(
    <ProjectLibraryWorkspace projectId={PID} active>
      <div>Canvas</div>
    </ProjectLibraryWorkspace>,
  );
  expect(screen.getByText("Item catalogue")).toBeInTheDocument();
});

it("offers three peer tabs for game items, captured items and images", async () => {
  const user = userEvent.setup();
  render(<Workspace />);
  await user.click(screen.getByRole("button", { name: /boutons|buttons/i }));
  await user.click(screen.getByRole("tab", { name: /items capturés|captured items/i }));
  expect(screen.getByText("Captured catalogue")).toBeInTheDocument();
  expect(screen.getAllByRole("tab")).toHaveLength(3);
  expect(screen.getByRole("tab", { name: /items du jeu|game items/i })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /^images$/i })).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: /graphics|graphiques/i })).toBeNull();
});

it("returns to properties when a mobile library item changes the selection", () => {
  desktop = false;
  useProjectLibraryStore.getState().open(PID);
  render(<Workspace />);
  act(() => useSelectionStore.getState().set(["new-item"]));
  expect(useProjectLibraryStore.getState().projectId).toBeNull();
  expect([...useSelectionStore.getState().ids]).toEqual(["new-item"]);
});

it("does not carry an open catalogue into a different project", async () => {
  const user = userEvent.setup();
  const view = render(<Workspace />);
  await user.click(screen.getByRole("button", { name: /boutons|buttons/i }));
  view.rerender(<Workspace projectId={"p2" as ProjectId} />);
  expect(screen.queryByText("Item catalogue")).not.toBeInTheDocument();
});

it("Escape closes the library before document navigation", async () => {
  const user = userEvent.setup();
  render(<Workspace />);
  await user.click(screen.getByRole("button", { name: /boutons|buttons/i }));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByText("Item catalogue")).not.toBeInTheDocument();
});

it("reopens the library from another workspace view instead of closing a hidden panel", async () => {
  const onOpen = vi.fn();
  useProjectLibraryStore.getState().open(PID, "captured");
  render(<ProjectLibraryButton projectId={PID} active={false} onOpen={onOpen} />);
  await userEvent.click(screen.getByRole("button", { name: /boutons|buttons/i }));
  expect(onOpen).toHaveBeenCalledOnce();
  expect(useProjectLibraryStore.getState().projectId).toBe(PID);
});

it("resizes from the right edge on desktop and remembers the width without remounting the canvas", () => {
  const view = render(<Workspace />);
  const canvas = screen.getByText("Canvas and properties");
  act(() => useProjectLibraryStore.getState().open(PID));
  const divider = screen.getByRole("separator");
  vi.spyOn(divider.parentElement!, "getBoundingClientRect").mockReturnValue({
    left: 100,
    right: 1100,
    top: 0,
    bottom: 600,
    width: 1000,
    height: 600,
  } as DOMRect);
  fireEvent.pointerDown(divider, { pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 550, pointerId: 1 });
  fireEvent.pointerUp(window, { pointerId: 1 });
  expect(useProjectLibraryStore.getState().width).toBe(450);
  expect(screen.getByText("Canvas and properties")).toBe(canvas);
  expect(JSON.parse(localStorage.getItem("artisan-library-size")!).state).toEqual({
    width: 450,
    height: 280,
    projectId: PID,
    category: "items",
  });
  view.unmount();
  render(<Workspace />);
  expect(useProjectLibraryStore.getState().width).toBe(450);
});

it("resizes the mobile library from its top edge while keeping canvas space", () => {
  desktop = false;
  render(<Workspace />);
  act(() => useProjectLibraryStore.getState().open(PID));
  const divider = screen.getByRole("separator");
  expect(divider).toHaveAttribute("aria-orientation", "horizontal");
  vi.spyOn(divider.parentElement!, "getBoundingClientRect").mockReturnValue({
    left: 0,
    right: 390,
    top: 100,
    bottom: 700,
    width: 390,
    height: 600,
  } as DOMRect);
  fireEvent.pointerDown(divider, { pointerId: 1 });
  fireEvent.pointerMove(window, { clientY: 380, pointerId: 1 });
  expect(useProjectLibraryStore.getState().height).toBe(320);
  fireEvent.pointerMove(window, { clientY: 0, pointerId: 1 });
  expect(useProjectLibraryStore.getState().height).toBeLessThanOrEqual(400);
  fireEvent.pointerUp(window, { pointerId: 1 });
});

it("moves below the canvas when desktop panels leave too little horizontal space", () => {
  let resize: (width: number) => void = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = (width) =>
          callback(
            [{ contentRect: { width, height: 600 } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
      }
      observe() {}
      disconnect() {}
    },
  );
  try {
    render(<Workspace />);
    act(() => useProjectLibraryStore.getState().open(PID));
    const canvas = screen.getByText("Canvas and properties");
    act(() => resize(480));
    expect(screen.getByRole("separator")).toHaveAttribute("aria-orientation", "horizontal");
    expect(screen.getByText("Canvas and properties")).toBe(canvas);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("migrates the retired graphics category while preserving panel geometry", async () => {
  localStorage.setItem(
    "artisan-library-size",
    JSON.stringify({
      state: { width: 410, height: 300, projectId: PID, category: "graphics" },
      version: 0,
    }),
  );
  await useProjectLibraryStore.persist.rehydrate();
  expect(useProjectLibraryStore.getState()).toMatchObject({
    width: 410,
    height: 300,
    projectId: PID,
    category: "items",
  });
});
it("remembers the captured tab after closing and reopening", () => {
  useProjectLibraryStore.getState().open(PID, "captured");
  useProjectLibraryStore.getState().close();
  useProjectLibraryStore.getState().open(PID);
  expect(useProjectLibraryStore.getState().category).toBe("captured");
});
