import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Library } from "./Library";
import { useTextureStore } from "./textureStore";
import type { LibraryData, CustomItemsData } from "@/lib/packApi";

vi.mock("@/state/uiStore", () => ({
  useUiStore: (sel: (s: { armedMaterial: null; setArmedMaterial: () => void }) => unknown) =>
    sel({ armedMaterial: null, setArmedMaterial: () => {} }),
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

const MOCK_CUSTOM: CustomItemsData = {
  serverKeyId: "srv_test_123",
  items: [
    { id: "nexo:iron_coin", label: "Iron Coin", category: "nexo", texture: "nexo/iron_coin" },
  ],
};

function seedStore(vanilla: LibraryData, custom: CustomItemsData = { serverKeyId: "", items: [] }) {
  const s = useTextureStore.getState();
  s.setData(vanilla.version, vanilla.items);
  s.setLibraryItems(vanilla.items);
  s.setLibraryCustomData(custom);
  s.setLibraryBundleReady(true);
  s.setLibraryError(false);
}

describe("Library", () => {
  beforeEach(() => seedStore(MOCK_DATA));

  it("renders all items when no filter", () => {
    render(<Library />);
    expect(screen.getByTitle("Diamond Sword")).toBeTruthy();
    expect(screen.getByTitle("Stone")).toBeTruthy();
    expect(screen.getByTitle("Bread")).toBeTruthy();
  });

  it("filters by search query", () => {
    render(<Library />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "diamond" } });
    expect(screen.getByTitle("Diamond Sword")).toBeTruthy();
    expect(screen.queryByTitle("Stone")).toBeNull();
  });

  it("filters by category chip", () => {
    render(<Library />);
    fireEvent.click(screen.getByRole("button", { name: /food/i }));
    expect(screen.queryByTitle("Diamond Sword")).toBeNull();
    expect(screen.getByTitle("Bread")).toBeTruthy();
  });
});

describe("Library with custom items", () => {
  beforeEach(() => seedStore(MOCK_DATA, MOCK_CUSTOM));

  it("shows custom items alongside vanilla items", () => {
    render(<Library />);
    expect(screen.getByTitle("Diamond Sword")).toBeTruthy();
    expect(screen.getByTitle("Iron Coin")).toBeTruthy();
  });

  it("shows nexo category chip", () => {
    render(<Library />);
    expect(screen.getByRole("button", { name: /nexo/i })).toBeTruthy();
  });

  it("filters custom items by category", () => {
    render(<Library />);
    fireEvent.click(screen.getByRole("button", { name: /nexo/i }));
    expect(screen.queryByTitle("Diamond Sword")).toBeNull();
    expect(screen.getByTitle("Iron Coin")).toBeTruthy();
  });
});
