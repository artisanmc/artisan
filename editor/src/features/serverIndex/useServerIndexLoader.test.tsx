import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const loadServerProjects = vi.fn();
vi.mock("./serverIndexLoader", () => ({
  loadServerProjects: (...args: unknown[]) => loadServerProjects(...args),
}));

import { useServerIndexStore } from "./serverIndexStore";
import { useServerIndexLoader } from "./useServerIndexLoader";

const project = (id: string) => ({
  id,
  name: id,
  documents: { menu: [], command: [], dialog: [] },
});

beforeEach(() => {
  loadServerProjects.mockReset();
  useServerIndexStore.getState().reset();
});

describe("useServerIndexLoader", () => {
  it("loads the server's projects once the edited project is ready", async () => {
    loadServerProjects.mockResolvedValue({
      status: "ready",
      projects: [project("boutique")],
      failed: [],
    });

    renderHook(() => useServerIndexLoader("srv", true));

    await waitFor(() => expect(useServerIndexStore.getState().status).toBe("ready"));
    expect(loadServerProjects).toHaveBeenCalledWith({ serverId: "srv" });
    expect(useServerIndexStore.getState().projects).toHaveLength(1);
    expect(useServerIndexStore.getState().scope).toBe("srv");
  });

  it("waits for the edited project: opening it never depends on the index", () => {
    renderHook(() => useServerIndexLoader("srv", false));
    expect(loadServerProjects).not.toHaveBeenCalled();
  });

  it("does nothing outside a server (demo)", () => {
    renderHook(() => useServerIndexLoader(undefined, true));
    expect(loadServerProjects).not.toHaveBeenCalled();
  });

  it("reports unavailable instead of throwing when the read fails", async () => {
    loadServerProjects.mockRejectedValue(new Error("boom"));

    renderHook(() => useServerIndexLoader("srv", true));

    await waitFor(() => expect(useServerIndexStore.getState().status).toBe("unavailable"));
  });

  it("drops the previous server's projects when the server changes", async () => {
    loadServerProjects.mockResolvedValueOnce({
      status: "ready",
      projects: [project("a")],
      failed: [],
    });
    const { rerender } = renderHook(({ srv }) => useServerIndexLoader(srv, true), {
      initialProps: { srv: "one" },
    });
    await waitFor(() => expect(useServerIndexStore.getState().projects).toHaveLength(1));

    let resolveSecond!: (value: unknown) => void;
    const second = new Promise<unknown>((resolve) => {
      resolveSecond = resolve;
    });
    loadServerProjects.mockReturnValueOnce(second);
    rerender({ srv: "two" });

    await waitFor(() => expect(useServerIndexStore.getState().scope).toBe("two"));
    expect(useServerIndexStore.getState().projects).toEqual([]);
    resolveSecond({ status: "ready", projects: [], failed: [] });
  });
});
