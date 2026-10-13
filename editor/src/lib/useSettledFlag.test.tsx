import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettledFlag } from "./useSettledFlag";

describe("useSettledFlag", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /**
   * The cache's nominal case: revalidation answers in a few hundred
   * milliseconds. A banner that appears and disappears in that interval costs
   * more attention than it informs.
   */
  it("reste faux si l'état se corrige avant le délai", () => {
    const { result, rerender } = renderHook(({ flag }) => useSettledFlag(flag, 600), {
      initialProps: { flag: true },
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    rerender({ flag: false });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(false);
  });

  /** What lingers must be said: the rule holds for real waits. */
  it("devient vrai quand l'état persiste", () => {
    const { result } = renderHook(() => useSettledFlag(true, 600));
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current).toBe(true);
  });

  it("retombe à faux sans délai", () => {
    const { result, rerender } = renderHook(({ flag }) => useSettledFlag(flag, 600), {
      initialProps: { flag: true },
    });
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(result.current).toBe(true);

    rerender({ flag: false });
    expect(result.current).toBe(false);
  });
});
