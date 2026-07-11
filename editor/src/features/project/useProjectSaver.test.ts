import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useProjectSaver } from "./useProjectSaver";
import * as userProjectsApi from "@/lib/api/userProjects";
import { useAuthStore } from "@/state/authStore";

describe("useProjectSaver", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ currentUser: null } as never);
  });

  it("uses saveUserProject when a user is signed in", async () => {
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
