import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useProjectSaver } from "./useProjectSaver";
import * as projectApi from "@/lib/projectApi";
import * as userProjectsApi from "@/lib/api/userProjects";
import { useSessionStore } from "@/state/sessionStore";
import { useAuthStore } from "@/state/authStore";

describe("useProjectSaver", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSessionStore.setState({ accessToken: null, serverKeyId: null } as never);
    useAuthStore.setState({ currentUser: null } as never);
  });

  it("uses saveProject in session mode", async () => {
    useSessionStore.setState({ accessToken: "tok", serverKeyId: "sk" } as never);
    const spy = vi.spyOn(projectApi, "saveProject").mockResolvedValue(undefined);
    const { result } = renderHook(() => useProjectSaver());
    await result.current({ id: "p1" } as never, { a: "x" });
    expect(spy).toHaveBeenCalled();
  });

  it("uses saveUserProject in user mode", async () => {
    useAuthStore.setState({ currentUser: { id: "u1", name: "x", email: "x@a.b" } } as never);
    const spy = vi.spyOn(userProjectsApi, "saveUserProject").mockResolvedValue(undefined);
    const { result } = renderHook(() => useProjectSaver());
    await result.current({ id: "p1" } as never, { a: "x" });
    expect(spy).toHaveBeenCalledWith("p1", expect.objectContaining({ files: { a: "x" } }));
  });

  it("throws when not authenticated", async () => {
    const { result } = renderHook(() => useProjectSaver());
    await expect(result.current({ id: "p1" } as never, {})).rejects.toThrow("Not authenticated");
  });
});
