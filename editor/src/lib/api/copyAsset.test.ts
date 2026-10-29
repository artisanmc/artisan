import type { Asset } from "@/domain/asset";
import * as local from "@/features/assets/localAssets";
import * as persisted from "@/features/project/persistedDrafts";
import { useAuthStore } from "@/state/authStore";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { copyAsset } from "./userAssets";
vi.mock("@/state/projectsStore", () => ({
  useProjectsStore: { getState: () => ({ setOpenProjects: vi.fn() }) },
}));

const asset = (fields: Partial<Asset>): Asset => ({
  id: "star",
  projectId: "shop",
  type: "glyph",
  name: "star",
  width: 8,
  height: 8,
  ascent: 7,
  codepoint: 57344,
  fontMeta: null,
  contentHash: "h1",
  createdAt: "",
  updatedAt: "",
  ...fields,
});

beforeEach(() => useAuthStore.setState({ currentUser: { id: "owner" } } as never));
afterEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ currentUser: null });
});

test("an identical asset already in the project is reused, nothing is copied", async () => {
  const here = asset({ id: "etoile", name: "etoile", projectId: "bank", codepoint: 57350 });
  vi.spyOn(local, "listLocalAssets").mockResolvedValue([here]);
  const mutation = vi.spyOn(persisted, "mutateDraftAssets");

  const result = await copyAsset("bank", asset({}));

  expect(result).toEqual({ asset: here, outcome: "reused" });
  expect(mutation).not.toHaveBeenCalled();
});

test("a glyph with other metrics is copied, and a taken name reports the rename", async () => {
  vi.spyOn(local, "listLocalAssets").mockResolvedValue([asset({ projectId: "bank", ascent: 4 })]);
  vi.spyOn(local, "readAssetFiles").mockResolvedValue({
    type: "glyph",
    name: "star",
    descriptor: "ascent: 7\n",
    binaries: [{ path: "", bytes: new Uint8Array([1, 2]) }],
  });
  const mutation = vi
    .spyOn(persisted, "mutateDraftAssets")
    .mockResolvedValue({ asset: asset({ id: "star_2", name: "star_2" }), draft: {} } as never);

  const result = await copyAsset("bank", asset({}));

  expect(result.outcome).toBe("renamed");
  expect(mutation.mock.calls[0]![1]).toEqual({
    suffix: "/copy",
    method: "POST",
    fields: {
      type: "glyph",
      name: "star",
      descriptor: "ascent: 7\n",
      files: JSON.stringify([{ path: "", base64: "AQI=" }]),
    },
  });
});
