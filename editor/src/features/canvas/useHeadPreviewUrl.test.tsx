import { useServersStore } from "@/state/serversStore";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useHeadPreviewUrl } from "./useHeadPreviewUrl";

const texture = btoa(
  JSON.stringify({
    textures: { SKIN: { url: `http://textures.minecraft.net/texture/${"a".repeat(64)}` } },
  }),
);

beforeEach(() => {
  useServersStore.setState({ activeServerId: "heads-server" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("updates all previews after one HDB lookup and keeps cached skins scoped to the server", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ texture }) });
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => [
    useHeadPreviewUrl("hdb:128276"),
    useHeadPreviewUrl("hdb:128276"),
  ]);
  await waitFor(() =>
    expect(result.current).toEqual(Array(2).fill(`https://mc-heads.net/head/${"a".repeat(64)}`)),
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toContain("/api/v1/servers/heads-server/head-texture?id=128276");
  fetcher.mockResolvedValue({ ok: false });
  act(() => useServersStore.setState({ activeServerId: "other-heads-server" }));
  expect(result.current).toEqual([undefined, undefined]);
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
});

it("keeps ordinary skins immediate without requesting the server", () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => [
    useHeadPreviewUrl(`basehead:${texture}`),
    useHeadPreviewUrl("playerhead:Notch"),
    useHeadPreviewUrl("hdb:invalid"),
  ]);
  expect(result.current).toEqual([
    `https://mc-heads.net/head/${"a".repeat(64)}`,
    "https://mc-heads.net/head/Notch",
    undefined,
  ]);
  expect(fetcher).not.toHaveBeenCalled();
});

it("retries unavailable heads so a reconnected server can supply the preview", async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ ok: true, json: async () => ({ texture }) });
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => useHeadPreviewUrl("hdb:42"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(result.current).toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(result.current).toBe(`https://mc-heads.net/head/${"a".repeat(64)}`);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
