import type { Asset } from "@/domain/asset";
import type { ProjectId } from "@/domain/types";
import { useProjectsStore } from "@/state/projectsStore";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const hit = vi.fn();
const copyInto = vi.fn();
vi.mock("./stageDropTarget", () => ({ tryStageSlotHit: (x: number, y: number) => hit(x, y) }));
vi.mock("@/features/assets/copyAssetInto", () => ({
  copyAssetInto: (...args: unknown[]) => copyInto(...args),
}));

import { dropCopiedImageButton } from "./imageButtonDrop";

const PID = "p_personal" as ProjectId;
const source = { id: "coin", projectId: "p_shop", width: 16, height: 16 } as Asset;
const copy = { ...source, projectId: PID, id: "coin_2" } as Asset;
let add: ReturnType<typeof vi.fn>;

beforeEach(() => {
  add = vi.fn(() => "e1");
  vi.spyOn(useProjectsStore, "getState").mockReturnValue({ addImageButton: add } as never);
});
afterEach(() => {
  vi.restoreAllMocks();
  hit.mockReset();
  copyInto.mockReset();
});

it("places the copy, never the source, on the slot read at release", async () => {
  hit.mockReturnValue({ menuId: "m1", position: 4 });
  copyInto.mockResolvedValue(copy);
  expect(await dropCopiedImageButton(PID, source, 10, 20)).toBe(true);
  expect(copyInto).toHaveBeenCalledWith(PID, source);
  expect(add).toHaveBeenCalledWith({ projectId: PID, menuId: "m1", position: 4, asset: copy });
});

it("copies nothing when released off the grid, and places nothing when the copy fails", async () => {
  hit.mockReturnValue(null);
  expect(await dropCopiedImageButton(PID, source, 0, 0)).toBe(false);
  expect(copyInto).not.toHaveBeenCalled();
  hit.mockReturnValue({ menuId: "m1", position: 4 });
  copyInto.mockResolvedValue(null);
  expect(await dropCopiedImageButton(PID, source, 0, 0)).toBe(false);
  expect(add).not.toHaveBeenCalled();
});

it("names an image of the server's library where it is: nothing is copied", async () => {
  const { dropImageButton } = await import("./imageButtonDrop");
  vi.spyOn((await import("@/state/selectionStore")).useSelectionStore, "getState").mockReturnValue({
    set: vi.fn(),
  } as never);
  hit.mockReturnValue({ menuId: "m1", position: 4 });
  const common = { id: "crest", projectId: "artisan", width: 40, height: 12 } as Asset;
  expect(dropImageButton(PID, common, 10, 20)).toBe(true);
  expect(copyInto).not.toHaveBeenCalled();
  expect(add).toHaveBeenCalledWith({ projectId: PID, menuId: "m1", position: 4, asset: common });
  // Another module's image is still not placed without its copy.
  expect(dropImageButton(PID, source, 10, 20)).toBe(false);
});
