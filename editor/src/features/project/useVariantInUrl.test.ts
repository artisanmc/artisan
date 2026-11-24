import type { Project } from "@/domain/types";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateProjectSearch } from "./ProjectCanvasPage";
import { useVariantInUrl } from "./useVariantInUrl";

describe("variant in the URL", () => {
  it("keeps a well-formed variant on every tab", () => {
    expect(validateProjectSearch({ tab: "board", variant: "textured" })).toEqual({
      tab: "board",
      variant: "textured",
    });
    expect(validateProjectSearch({ tab: "translations", variant: "bedrock" })).toEqual({
      tab: "translations",
      variant: "bedrock",
    });
    expect(validateProjectSearch({ variant: "textured" })).toEqual({ variant: "textured" });
  });

  it("drops a malformed one", () => {
    expect(validateProjectSearch({ tab: "board", variant: "Not A Name" })).toEqual({
      tab: "board",
    });
    expect(validateProjectSearch({ variant: 3 })).toEqual({});
  });
});

const navigate = vi.fn();
vi.mock("@tanstack/react-router", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
}));
const showVariant = vi.fn();
vi.mock("@/state/projectsStore", () => ({
  useProjectsStore: { getState: () => ({ showVariant }) },
}));

const project = (viewed?: string) =>
  ({
    id: "guilds",
    variants: { names: ["bedrock", "textured"], view: viewed ? { variant: viewed } : undefined },
  }) as unknown as Project;

describe("useVariantInUrl", () => {
  beforeEach(() => {
    navigate.mockClear();
    showVariant.mockClear();
  });

  it("shows the URL's variant once the module is loaded, without touching the URL", () => {
    renderHook(() => useVariantInUrl(project(), "textured"));
    expect(showVariant).toHaveBeenCalledWith("guilds", "textured");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("writes the shown variant to the URL, and drops it back on Default", () => {
    const { rerender } = renderHook(({ p, v }) => useVariantInUrl(p, v), {
      initialProps: { p: project(), v: undefined as string | undefined },
    });
    rerender({ p: project("bedrock"), v: undefined });
    const search = navigate.mock.calls.at(-1)?.[0].search;
    expect(search({ tab: "board" })).toEqual({ tab: "board", variant: "bedrock" });
    rerender({ p: project(), v: "bedrock" });
    expect(navigate.mock.calls.at(-1)?.[0].search({ variant: "bedrock" })).toEqual({
      variant: undefined,
    });
    expect(showVariant).not.toHaveBeenCalled();
  });

  it("drops a variant the module does not have", () => {
    renderHook(() => useVariantInUrl(project(), "winter"));
    expect(showVariant).not.toHaveBeenCalled();
    expect(navigate.mock.calls[0]?.[0].search({ variant: "winter" })).toEqual({
      variant: undefined,
    });
  });

  it("waits for the module's variants before reading the URL", () => {
    renderHook(() => useVariantInUrl({ id: "guilds" } as unknown as Project, "textured"));
    expect(showVariant).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
