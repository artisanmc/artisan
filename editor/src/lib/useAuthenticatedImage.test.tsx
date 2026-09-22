import { type Asset, assetPreviewUrl } from "@/domain/asset";
import { AssetPicker } from "@/features/assets/AssetPicker";
import { useAssetStore } from "@/features/assets/assetStore";
import { useAuthStore } from "@/state/authStore";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useAuthenticatedImage } from "./useAuthenticatedImage";
vi.mock("use-image", () => ({ default: (url: string) => [url] }));
afterEach(() => {
  act(() => useAuthStore.setState({ currentUser: null }));
  vi.unstubAllGlobals();
});

it("recovers a transient image read failure without remounting the button", async () => {
  useAuthStore.setState({ currentUser: { id: "owner" } } as never);
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 503 })
    .mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["png"]) });
  vi.stubGlobal("fetch", fetcher);
  URL.createObjectURL = vi.fn(() => "blob:recovered");
  URL.revokeObjectURL = vi.fn();
  const view = renderHook(() => useAuthenticatedImage("https://api.test/transient"));
  await waitFor(() => expect(view.result.current[0]).toBe("blob:recovered"), { timeout: 1800 });
  expect(fetcher).toHaveBeenCalledTimes(2);
  view.unmount();
});

it("hands the picker preview to a new canvas button without another request", async () => {
  useAuthStore.setState({ currentUser: { id: "owner" } } as never);
  const asset: Asset = {
    id: "buy",
    projectId: "shop",
    type: "glyph",
    name: "Buy",
    width: 16,
    height: 16,
    ascent: 8,
    codepoint: null,
    fontMeta: null,
    contentHash: "hash",
    createdAt: "",
    updatedAt: "",
  };
  useAssetStore.setState({ assets: [asset] });
  const fetcher = vi.fn(async () => ({ ok: true, blob: async () => new Blob(["png"]) }));
  vi.stubGlobal("fetch", fetcher);
  URL.createObjectURL = vi.fn(() => "blob:picker");
  URL.revokeObjectURL = vi.fn();
  function CanvasButton() {
    const [image] = useAuthenticatedImage(assetPreviewUrl(asset));
    return <output data-testid="canvas-image">{String(image)}</output>;
  }
  function Flow() {
    const [picked, setPicked] = useState(false);
    return picked ? (
      <CanvasButton />
    ) : (
      <AssetPicker open onClose={() => {}} onPick={() => setPicked(true)} />
    );
  }
  const view = render(<Flow />);
  await waitFor(() => expect(screen.getByAltText("Buy").getAttribute("src")).toBe("blob:picker"));
  fireEvent.click(screen.getByTitle("Buy"));
  expect(screen.getByTestId("canvas-image").textContent).toBe("blob:picker");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  view.unmount();
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:picker"));
});

it("shares a pending download and keeps it alive when one consumer unmounts", async () => {
  useAuthStore.setState({ currentUser: { id: "owner" } } as never);
  let complete!: (response: unknown) => void;
  const fetcher = vi.fn(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  URL.createObjectURL = vi.fn(() => "blob:pending");
  URL.revokeObjectURL = vi.fn();
  const first = renderHook(() => useAuthenticatedImage("https://api.test/pending"));
  const second = renderHook(() => useAuthenticatedImage("https://api.test/pending"));
  first.unmount();
  await act(async () => {
    complete({ ok: true, blob: async () => new Blob(["png"]) });
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(second.result.current[0]).toBe("blob:pending");
  second.unmount();
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:pending"));
});

it("reuses an already visible image when another button uses it", async () => {
  useAuthStore.setState({ currentUser: { id: "owner" } } as never);
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob(["png"]),
    })
    .mockImplementation(() => new Promise(() => {}));
  vi.stubGlobal("fetch", fetcher);
  URL.createObjectURL = vi.fn(() => "blob:shared");
  URL.revokeObjectURL = vi.fn();
  const first = renderHook(() => useAuthenticatedImage("https://api.test/button?h=one"));
  await waitFor(() => expect(first.result.current[0]).toBe("blob:shared"));
  const second = renderHook(() => useAuthenticatedImage("https://api.test/button?h=one"));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(second.result.current[0]).toBe("blob:shared");
  first.unmount();
  expect(second.result.current[0]).toBe("blob:shared");
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  second.unmount();
  await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:shared"));
});
it("loads private PNG bytes with cookies and revokes the preview on owner change", async () => {
  useAuthStore.setState({ currentUser: { id: "owner" } } as never);
  const fetcher = vi.fn(async () => ({
    ok: true,
    blob: async () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }),
  }));
  vi.stubGlobal("fetch", fetcher);
  URL.createObjectURL = vi.fn(() => "blob:private");
  URL.revokeObjectURL = vi.fn();
  const { result, unmount, rerender } = renderHook(
    ({ hash }) => useAuthenticatedImage(`https://api.test/private.png?draftId=d&h=${hash}`),
    { initialProps: { hash: "one" } },
  );
  await waitFor(() => expect(result.current[0]).toBe("blob:private"));
  expect(fetcher).toHaveBeenCalledWith(
    "https://api.test/private.png?draftId=d&h=one",
    expect.objectContaining({ credentials: "include" }),
  );
  rerender({ hash: "two" });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private");
  act(() => useAuthStore.setState({ currentUser: null }));
  expect(result.current[0]).toBe("");
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:private");
  unmount();
  vi.unstubAllGlobals();
});
