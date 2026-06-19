import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useProjectLoader } from "./useProjectLoader";
import * as projectApi from "@/lib/projectApi";
import * as userProjectsApi from "@/lib/api/userProjects";
import { useSessionStore } from "@/state/sessionStore";
import { useAuthStore } from "@/state/authStore";

describe("useProjectLoader", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSessionStore.setState({ accessToken: null, serverKeyId: null } as never);
    useAuthStore.setState({ currentUser: null } as never);
  });

  it("uses session mode when accessToken set", async () => {
    useSessionStore.setState({ accessToken: "tok", serverKeyId: "sk" } as never);
    vi.spyOn(projectApi, "loadProjects").mockResolvedValue([{ id: "p1" } as never]);
    const { result } = renderHook(() => useProjectLoader("p1"));
    await waitFor(() => expect(result.current.pack).not.toBeNull());
    expect(result.current.mode).toBe("session");
    expect(result.current.error).toBeNull();
  });

  it("uses user mode when only currentUser set", async () => {
    useAuthStore.setState({ currentUser: { id: "u1", name: "x", email: "x@a.b" } } as never);
    vi.spyOn(userProjectsApi, "loadUserProject").mockResolvedValue({
      project: { id: "p1", name: "p", hash: "h" },
      files: {},
      editor: { id: "p1", menus: [] },
    } as never);
    const { result } = renderHook(() => useProjectLoader("p1"));
    await waitFor(() => expect(result.current.pack).not.toBeNull());
    expect(result.current.mode).toBe("user");
    expect(result.current.error).toBeNull();
  });

  it("sets error when neither auth available", async () => {
    const { result } = renderHook(() => useProjectLoader("p1"));
    await waitFor(() => expect(result.current.error).toBe("Not authenticated"));
    expect(result.current.pack).toBeNull();
    expect(result.current.mode).toBeNull();
  });
});
