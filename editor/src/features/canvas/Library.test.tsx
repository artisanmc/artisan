import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Library } from "./Library";
import * as packApi from "@/lib/packApi";
import type { LibraryData } from "@/lib/packApi";

vi.mock("@/state/uiStore", () => ({
  useUiStore: (sel: (s: { armedMaterial: null; setArmedMaterial: () => void }) => unknown) =>
    sel({ armedMaterial: null, setArmedMaterial: () => {} }),
}));
vi.mock("@/state/sessionStore", () => ({
  useSessionStore: (sel: (s: { accessToken: string }) => unknown) => sel({ accessToken: "test-token" }),
}));
vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, isDragging: false }),
}));

const MOCK_DATA: LibraryData = {
  version: "1.21.4",
  items: [
    { id: "diamond_sword", label: "Diamond Sword", category: "combat", texture: "item/diamond_sword" },
    { id: "stone",         label: "Stone",         category: "misc",   texture: "item/stone" },
    { id: "bread",         label: "Bread",         category: "food",   texture: "item/bread" },
  ],
};

describe("Library", () => {
  beforeEach(() => {
    vi.spyOn(packApi, "fetchItems").mockResolvedValue(MOCK_DATA);
  });

  it("renders all items when no filter", async () => {
    render(<Library />);
    expect(await screen.findByTitle("Diamond Sword")).toBeTruthy();
    expect(screen.getByTitle("Stone")).toBeTruthy();
    expect(screen.getByTitle("Bread")).toBeTruthy();
  });

  it("filters by search query", async () => {
    render(<Library />);
    await screen.findByTitle("Diamond Sword");
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "diamond" } });
    expect(screen.getByTitle("Diamond Sword")).toBeTruthy();
    expect(screen.queryByTitle("Stone")).toBeNull();
  });

  it("filters by category chip", async () => {
    render(<Library />);
    await screen.findByTitle("Diamond Sword");
    fireEvent.click(screen.getByRole("button", { name: /food/i }));
    expect(screen.queryByTitle("Diamond Sword")).toBeNull();
    expect(screen.getByTitle("Bread")).toBeTruthy();
  });
});
