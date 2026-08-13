import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useProjectLoader } from "./useProjectLoader";
import * as userProjectsApi from "@/lib/api/userProjects";
import * as projectFilesApi from "@/lib/api/projectFiles";
import { useAuthStore } from "@/state/authStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";

describe("useProjectLoader", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ currentUser: null } as never);
  });

  it("charge le contenu depuis le DISQUE du serveur, pas depuis le backend", async () => {
    useAuthStore.setState({ currentUser: { id: "u1", name: "x", email: "x@a.b" } } as never);
    vi.spyOn(userProjectsApi, "loadUserProject").mockResolvedValue({
      project: { id: "p1", name: "p", hash: "h", externalId: "boutique_shop" },
      networkId: "net_1",
      serverKeyId: "sk_1",
    } as never);
    const readSpy = vi
      .spyOn(projectFilesApi, "readProjectFiles")
      .mockResolvedValue({ ok: true, files: { "manifest.yaml": "id: boutique_shop\n" } });

    const { result } = renderHook(() => useProjectLoader("p1"));

    await waitFor(() => expect(result.current.project).not.toBeNull());
    expect(result.current.error).toBeNull();
    // Lu sous l'id disque, auprès du serveur propriétaire.
    expect(readSpy).toHaveBeenCalledWith("net_1", "sk_1", "boutique_shop");
    // Ce qui a été lu devient la base du compare-and-swap.
    expect(useProjectBaselineStore.getState().get("p1")).toEqual({
      "manifest.yaml": "id: boutique_shop\n",
    });
  });

  it("serveur hors ligne : pas de repli, le Project n'est pas ouvrable", async () => {
    useAuthStore.setState({ currentUser: { id: "u1", name: "x", email: "x@a.b" } } as never);
    vi.spyOn(userProjectsApi, "loadUserProject").mockResolvedValue({
      project: { id: "p1", name: "p", hash: "h" },
      networkId: "net_1",
      serverKeyId: "sk_1",
    } as never);
    vi.spyOn(projectFilesApi, "readProjectFiles").mockResolvedValue({
      ok: false,
      error: "server_offline",
    });

    const { result } = renderHook(() => useProjectLoader("p1"));

    await waitFor(() => expect(result.current.offline).toBe(true));
    expect(result.current.project).toBeNull();
  });

  it("sets error when no user is signed in", async () => {
    const { result } = renderHook(() => useProjectLoader("p1"));
    await waitFor(() => expect(result.current.error).toBe("Not authenticated"));
    expect(result.current.project).toBeNull();
  });
});
