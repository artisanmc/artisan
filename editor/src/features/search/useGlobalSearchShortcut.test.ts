import { useUiStore } from "@/state/uiStore";
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useGlobalSearchShortcut } from "./useGlobalSearchShortcut";

describe("useGlobalSearchShortcut", () => {
  it("Cmd/Ctrl+K opens the palette", () => {
    useUiStore.setState({ searchOpen: false } as any);
    renderHook(() => useGlobalSearchShortcut());
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
    expect(useUiStore.getState().searchOpen).toBe(true);
  });
  it("no-op when already open", () => {
    useUiStore.setState({ searchOpen: true } as any);
    renderHook(() => useGlobalSearchShortcut());
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    expect(useUiStore.getState().searchOpen).toBe(true);
  });
});
