import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import type { ElementId, PackId } from "@/domain/types";

const navigate = vi.fn();

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    useNavigate: () => navigate,
  };
});

// Import AFTER the mock is registered so the module sees the mocked router.
const { useElementDblClickNav } = await import("./useElementDblClickNav");

const PACK_ID = "ws1" as PackId;
const ELEMENT_ID = "elem-abc" as ElementId;

function makeFakeEvent(overrides?: Partial<{ cancelBubble: boolean }>): any {
  return { cancelBubble: false, ...overrides };
}

describe("useElementDblClickNav", () => {
  beforeEach(() => {
    navigate.mockClear();
  });

  it("calls navigate with the correct route and params on dblclick", () => {
    const { result } = renderHook(() => useElementDblClickNav(PACK_ID, ELEMENT_ID));
    const handler = result.current;

    const e = makeFakeEvent();
    handler(e);

    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith({
      to: "/workspace/$workspaceId/element/$elementId",
      params: { workspaceId: PACK_ID, elementId: ELEMENT_ID },
    });
  });

  it("sets cancelBubble = true to prevent stage-level handlers", () => {
    const { result } = renderHook(() => useElementDblClickNav(PACK_ID, ELEMENT_ID));
    const e = makeFakeEvent();
    result.current(e);
    expect(e.cancelBubble).toBe(true);
  });

  it("produces a stable reference when deps do not change", () => {
    const { result, rerender } = renderHook(() => useElementDblClickNav(PACK_ID, ELEMENT_ID));
    const first = result.current;
    rerender();
    // useCallback with stable deps must return the same function identity.
    expect(result.current).toBe(first);
  });

  it("updates the handler when elementId changes", () => {
    const OTHER_ID = "elem-xyz" as ElementId;
    const { result, rerender } = renderHook(
      ({ id }: { id: ElementId }) => useElementDblClickNav(PACK_ID, id),
      { initialProps: { id: ELEMENT_ID } },
    );

    rerender({ id: OTHER_ID });
    result.current(makeFakeEvent());

    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ elementId: OTHER_ID }) }),
    );
  });
});
