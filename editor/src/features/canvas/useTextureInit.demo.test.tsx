import { useAuthStore } from "@/state/authStore";
import { useDemoStore } from "@/state/demoStore";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useTextureStore } from "./textureStore";
import { useTextureInit } from "./useTextureInit";
vi.mock("@/lib/mcModelRenderer", () => ({
  preloadModels: vi.fn(async () => {}),
  renderToCanvas: vi.fn(),
}));
vi.mock("@/state/accountStore", () => ({
  useAccountStore: { getState: () => ({ setAccount: vi.fn() }) },
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useDemoStore.getState().setSession(null);
});
test("guest canvas fetches its versioned item catalog without an account", async () => {
  useAuthStore.setState({ currentUser: null });
  useDemoStore.getState().setSession({
    principal: { kind: "guest", id: "demo_owner" },
    projectId: "demo_project",
    csrfToken: "csrf",
    expiresAt: "2099-01-01",
  });
  const fetcher = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.endsWith("/custom-items")
            ? { serverKeyId: "", items: [] }
            : { version: "1.21.11", items: [{ id: "compass", texture: "item/compass" }] },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  renderHook(() => useTextureInit("demo_project"));
  await waitFor(() => expect(useTextureStore.getState().byMaterial.compass).toBe("item/compass"));
  expect(fetcher).toHaveBeenCalledWith(
    expect.stringContaining("/demo_project/items"),
    expect.objectContaining({ credentials: "include" }),
  );
  expect(useTextureStore.getState().version).toBe("1.21.11");
});
test("switching from a server project to a guest clears custom textures and rejects late catalog responses", async () => {
  useDemoStore.getState().setSession(null);
  useAuthStore.setState({ currentUser: { id: "account" } } as never);
  let release!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("/server/items"))
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      return Promise.resolve(
        new Response(
          JSON.stringify(
            url.endsWith("/custom-items")
              ? { serverKeyId: "", items: [] }
              : { version: "guest-version", items: [{ id: "compass", texture: "item/compass" }] },
          ),
        ),
      );
    }),
  );
  const hook = renderHook(({ id }) => useTextureInit(id), { initialProps: { id: "server" } });
  useTextureStore.setState({
    customByMaterial: { private_item: "private-url" },
    renderedByMaterial: { private_item: "private-pixels" },
  });
  act(() => {
    useDemoStore.getState().setSession({
      principal: { kind: "guest", id: "guest" },
      projectId: "demo",
      csrfToken: "csrf",
      expiresAt: "2099-01-01",
    });
    hook.rerender({ id: "demo" });
  });
  await waitFor(() => expect(useTextureStore.getState().version).toBe("guest-version"));
  expect(useTextureStore.getState().customByMaterial).toEqual({});
  expect(useTextureStore.getState().renderedByMaterial).toEqual({});
  await act(async () => {
    release(
      new Response(
        JSON.stringify({
          version: "old-server",
          items: [{ id: "private_item", texture: "secret" }],
        }),
      ),
    );
  });
  expect(useTextureStore.getState().version).toBe("guest-version");
  expect(useTextureStore.getState().byMaterial.private_item).toBeUndefined();
});
