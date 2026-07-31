import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useProjectLoader } from "./useProjectLoader";
import * as userProjectsApi from "@/lib/api/userProjects";
import { useAuthStore } from "@/state/authStore";

describe("useProjectLoader", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ currentUser: null } as never);
  });

  it("loads via loadUserProject when a user is signed in", async () => {
    useAuthStore.setState({ currentUser: { id: "u1", name: "x", email: "x@a.b" } } as never);
    vi.spyOn(userProjectsApi, "loadUserProject").mockResolvedValue({
      project: { id: "p1", name: "p", hash: "h" },
      networkId: "net_1",
      serverKeyId: "sk_1",
      files: {},
    } as never);
    const { result } = renderHook(() => useProjectLoader("p1"));
    await waitFor(() => expect(result.current.project).not.toBeNull());
    expect(result.current.error).toBeNull();
  });

  it("sets error when no user is signed in", async () => {
    const { result } = renderHook(() => useProjectLoader("p1"));
    await waitFor(() => expect(result.current.error).toBe("Not authenticated"));
    expect(result.current.project).toBeNull();
  });
});
