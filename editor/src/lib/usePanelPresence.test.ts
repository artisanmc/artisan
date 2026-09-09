import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { usePanelPresence } from "./usePanelPresence";

afterEach(() => vi.useRealTimers());

it("removes immediately when reduced motion is requested", () => {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  const media = vi.spyOn(window, "matchMedia").mockReturnValue({ ...query, matches: true });
  try {
    const { result, rerender } = renderHook(({ open }) => usePanelPresence(open), {
      initialProps: { open: true },
    });
    rerender({ open: false });
    expect(result.current).toEqual({ mounted: false, expanded: false });
  } finally {
    media.mockRestore();
  }
});

it("keeps content for the exit transition and cancels removal when reopened", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ open }) => usePanelPresence(open), {
    initialProps: { open: true },
  });
  rerender({ open: false });
  expect(result.current.mounted).toBe(true);
  expect(result.current.expanded).toBe(false);
  act(() => vi.advanceTimersByTime(100));
  rerender({ open: true });
  act(() => vi.advanceTimersByTime(300));
  expect(result.current).toEqual({ mounted: true, expanded: true });
  rerender({ open: false });
  act(() => vi.advanceTimersByTime(220));
  expect(result.current.mounted).toBe(false);
});

it("mounts a closed panel before expanding it", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(({ open }) => usePanelPresence(open), {
    initialProps: { open: false },
  });
  rerender({ open: true });
  expect(result.current).toEqual({ mounted: true, expanded: false });
  act(() => vi.advanceTimersByTime(50));
  expect(result.current.expanded).toBe(true);
});
