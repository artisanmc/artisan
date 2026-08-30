import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettledFlag } from "./useSettledFlag";

describe("useSettledFlag", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /**
   * Le cas nominal du cache : la revalidation répond en quelques centaines de
   * millisecondes. Un bandeau qui apparaît et disparaît dans cet intervalle
   * coûte plus d'attention qu'il n'en informe.
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

  /** Ce qui s'attarde doit se dire : la règle tient pour les attentes réelles. */
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
