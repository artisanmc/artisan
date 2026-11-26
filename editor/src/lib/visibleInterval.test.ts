import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { visibleInterval } from "./visibleInterval";

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("visibleInterval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setHidden(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    setHidden(false);
  });

  it("ticks while the tab is visible", () => {
    const fn = vi.fn();
    const stop = visibleInterval(fn, 1000);
    vi.advanceTimersByTime(3000);
    expect(fn).toHaveBeenCalledTimes(3);
    stop();
  });

  it("skips ticks while hidden, then runs once when shown", () => {
    const fn = vi.fn();
    const stop = visibleInterval(fn, 1000);
    setHidden(true);
    vi.advanceTimersByTime(10_000);
    expect(fn).not.toHaveBeenCalled();
    setHidden(false);
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not run on show when no tick was skipped", () => {
    const fn = vi.fn();
    const stop = visibleInterval(fn, 1000);
    setHidden(true);
    setHidden(false);
    expect(fn).not.toHaveBeenCalled();
    stop();
  });

  it("stops ticking and listening after cleanup", () => {
    const fn = vi.fn();
    const stop = visibleInterval(fn, 1000);
    setHidden(true);
    vi.advanceTimersByTime(1000);
    stop();
    setHidden(false);
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });
});
