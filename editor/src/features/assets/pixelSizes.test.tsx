import * as drafts from "@/lib/api/projectDrafts";
import { createImage, encodePng } from "@/lib/pack/png";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useImageMarks } from "./imageStanding";
import * as local from "./localAssets";
import { type MeasuredFile, resetPixelSizes, usePixelSizes } from "./pixelSizes";

const png = (width: number, height: number) => encodePng(createImage(width, height));
const file = (path: string, hash: string, extra: Partial<MeasuredFile> = {}): MeasuredFile => ({
  projectId: "p1",
  path,
  hash,
  ...extra,
});

beforeEach(() => {
  resetPixelSizes();
  useProjectDraftStore.setState({ drafts: {} });
  useProjectBaselineStore.setState({ baselines: {}, binaryBaselines: {} });
});
afterEach(() => vi.restoreAllMocks());

describe("usePixelSizes", () => {
  it("reads each content once: the published file, or the draft's blob when it changed there", async () => {
    const published = vi
      .spyOn(local, "readPublishedBinary")
      .mockImplementation(async (_project, path) =>
        path.endsWith("note.png") ? null : png(54, 18),
      );
    const blob = vi.spyOn(drafts, "readDraftBlob").mockResolvedValue(png(60, 18));
    useProjectDraftStore.setState({
      drafts: {
        p1: {
          remote: { id: "d1" },
          binaryBaseline: {
            "assets/textures/crest.png": { hash: "old", size: 1 },
            "originals/assets/textures/crest.png": { hash: "orig", size: 1 },
            "assets/textures/note.png": { hash: "none", size: 1 },
          },
          binaryTree: { "assets/textures/crest.png": { hash: "new", size: 1 } },
        } as never,
      },
    });
    const files = [
      file("originals/assets/textures/crest.png", "orig"),
      file("assets/textures/crest.png", "new"),
      // Asked as published: the draft is not looked at.
      file("assets/textures/crest.png", "old", { published: true }),
      file("assets/textures/note.png", "none"),
    ];
    const { result, rerender } = renderHook(({ wanted }) => usePixelSizes(wanted), {
      initialProps: { wanted: files },
    });
    expect(result.current("new")).toBeUndefined();
    await waitFor(() => expect(result.current("none")).toBeNull());
    expect(result.current("orig")).toEqual({ width: 54, height: 18 });
    expect(result.current("new")).toEqual({ width: 60, height: 18 });
    expect(result.current("old")).toEqual({ width: 54, height: 18 });
    expect(blob).toHaveBeenCalledWith("p1", "d1", "new");
    // The same contents asked again cost nothing.
    rerender({ wanted: [...files] });
    expect(published).toHaveBeenCalledTimes(3);
    expect(blob).toHaveBeenCalledTimes(1);
  });

  it("leaves a file that cannot be fetched unmeasured, and asks again later", async () => {
    const published = vi
      .spyOn(local, "readPublishedBinary")
      .mockRejectedValueOnce(new Error("storage_unavailable"))
      .mockResolvedValue(png(8, 8));
    const { result, rerender } = renderHook(({ wanted }) => usePixelSizes(wanted), {
      initialProps: { wanted: [file("assets/textures/a.png", "a")] },
    });
    await waitFor(() => expect(published).toHaveBeenCalledTimes(1));
    expect(result.current("a")).toBeUndefined();
    rerender({ wanted: [file("assets/textures/a.png", "a")] });
    await waitFor(() => expect(result.current("a")).toEqual({ width: 8, height: 8 }));
  });
});

describe("useImageMarks", () => {
  it("says an image is not taken from its pixels, where its descriptor states no size", async () => {
    vi.spyOn(local, "readPublishedBinary").mockImplementation(async (_project, path) =>
      path.startsWith("originals/") ? png(54, 18) : png(60, 18),
    );
    useProjectBaselineStore.setState({
      baselines: {
        p1: {
          "originals/assets/textures/crest.yml": "function: menu\nwidth: 54\nheight: 18\n",
          "assets/textures/crest.yml": "ramps: true\n",
        },
      },
      binaryBaselines: {
        p1: {
          "originals/assets/textures/crest.png": { hash: "o1", size: 1 },
          "assets/textures/crest.png": { hash: "m1", size: 1 },
        },
      },
    });
    const { result } = renderHook(() => useImageMarks("p1"));
    const crest = { id: "crest", type: "texture" as const };
    // Before the files are read, the descriptors speak: nothing says it is refused.
    expect(result.current(crest)).toBe("own_version");
    await waitFor(() => expect(result.current(crest)).toBe("other_size"));
  });
});
