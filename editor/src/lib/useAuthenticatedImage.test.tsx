import { useAuthStore } from "@/state/authStore";
import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useAuthenticatedImage } from "./useAuthenticatedImage";
vi.mock("use-image", () => ({ default: (url: string) => [url] }));
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
