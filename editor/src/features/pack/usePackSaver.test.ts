import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePackSaver } from "./usePackSaver";
import * as packApi from "@/lib/packApi";
import * as userPacksApi from "@/lib/api/userPacks";
import { useSessionStore } from "@/state/sessionStore";
import { useAuthStore } from "@/state/authStore";

describe("usePackSaver", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useSessionStore.setState({ accessToken: null, serverKeyId: null } as never);
    useAuthStore.setState({ currentUser: null } as never);
  });

  it("uses savePack in session mode", async () => {
    useSessionStore.setState({ accessToken: "tok", serverKeyId: "sk" } as never);
    const spy = vi.spyOn(packApi, "savePack").mockResolvedValue(undefined);
    const { result } = renderHook(() => usePackSaver());
    await result.current({ id: "p1" } as never, { a: "x" });
    expect(spy).toHaveBeenCalled();
  });

  it("uses saveUserPack in user mode", async () => {
    useAuthStore.setState({ currentUser: { id: "u1", name: "x", email: "x@a.b" } } as never);
    const spy = vi.spyOn(userPacksApi, "saveUserPack").mockResolvedValue(undefined);
    const { result } = renderHook(() => usePackSaver());
    await result.current({ id: "p1" } as never, { a: "x" });
    expect(spy).toHaveBeenCalledWith("p1", expect.objectContaining({ files: { a: "x" } }));
  });

  it("throws when not authenticated", async () => {
    const { result } = renderHook(() => usePackSaver());
    await expect(result.current({ id: "p1" } as never, {})).rejects.toThrow("Not authenticated");
  });
});
