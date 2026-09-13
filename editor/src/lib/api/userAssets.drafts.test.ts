import { expect, it, vi } from "vitest";
import { uploadAsset } from "./userAssets";
const snapshot = { baseline: {}, tree: {}, at: 1 };
vi.mock("@/features/project/persistedDrafts", () => ({
  mutateDraftAssets: async (
    _id: string,
    asset: unknown,
    perform: (operation: unknown) => Promise<unknown>,
  ) =>
    perform({
      id: "private",
      operationId: "upload-one",
      revision: 4,
      name: "Work",
      snapshot,
      asset,
    }),
}));
it("uploads PNGs only into the private draft with the frozen revision and credentials", async () => {
  const fetcher = vi.fn(async () => ({
    ok: true,
    json: async () => ({ draft: { revision: 5 }, asset: { id: "icon" } }),
  }));
  vi.stubGlobal("fetch", fetcher);
  await uploadAsset("project", {
    name: "Icon",
    type: "texture",
    file: new File([new Uint8Array([137, 80, 0, 255])], "icon.png", { type: "image/png" }),
  } as never);
  expect(fetcher.mock.calls[0]![0]).toContain("/project/assets?draftId=private&draftRevision=4");
  const request = fetcher.mock.calls[0]![1] as RequestInit;
  expect(request.credentials).toBe("include");
  expect(request.headers).toEqual({ "Idempotency-Key": "upload-one" });
  expect((request.body as FormData).get("draftSnapshot")).toBe(JSON.stringify(snapshot));
  expect((request.body as FormData).get("draftName")).toBe("Work");
  vi.unstubAllGlobals();
});
