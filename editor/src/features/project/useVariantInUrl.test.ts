import type { Project } from "@/domain/types";
import { useViewAsStore } from "@/state/viewAsStore";
import { act, renderHook } from "@testing-library/react";
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
    useViewAsStore.setState({ variant: undefined });
  });

  it("shows the variant picked in the last module, the URL saying nothing", () => {
    useViewAsStore.setState({ variant: "bedrock" });
    renderHook(() => useVariantInUrl(project(), undefined));
    expect(showVariant).toHaveBeenCalledWith("guilds", "bedrock");
  });

  it("makes the URL's variant the pick, then shows it once the module has it", () => {
    renderHook(() => useVariantInUrl(project(), "textured"));
    expect(useViewAsStore.getState().variant).toBe("textured");
    expect(showVariant).toHaveBeenCalledWith("guilds", "textured");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("writes the pick to the URL, and drops it back on Default", () => {
    const { rerender } = renderHook(({ p, v }) => useVariantInUrl(p, v), {
      initialProps: { p: project("bedrock"), v: undefined as string | undefined },
    });
    act(() => useViewAsStore.setState({ variant: "bedrock" }));
    expect(navigate.mock.calls.at(-1)?.[0].search({ tab: "board" })).toEqual({
      tab: "board",
      variant: "bedrock",
    });
    rerender({ p: project("bedrock"), v: "bedrock" });
    act(() => useViewAsStore.setState({ variant: undefined }));
    // The module shows its own Documents again.
    expect(showVariant).toHaveBeenCalledWith("guilds", undefined);
  });

  it("keeps a variant the module has no version of as the pick, on its own Documents", () => {
    useViewAsStore.setState({ variant: "winter" });
    renderHook(() => useVariantInUrl(project(), "winter"));
    expect(showVariant).not.toHaveBeenCalled();
    expect(useViewAsStore.getState().variant).toBe("winter");
  });

  it("waits for the module's variants before reading the URL", () => {
    renderHook(() => useVariantInUrl({ id: "guilds" } as unknown as Project, "textured"));
    expect(showVariant).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
