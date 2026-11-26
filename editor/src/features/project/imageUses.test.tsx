import { useServerIndexStore } from "@/features/serverIndex/serverIndexStore";
import { commonImageKey, moduleImageKey } from "@/lib/pack/kit";
import { mockOpenProjects } from "@/mock/fixtures";
import { renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { imageUseName, menusNamingCommon, useImageUses } from "./imageUses";

// A module's kind that asks the pack for the images its files name.
vi.mock("@artisan/editor-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@artisan/editor-sdk")>()),
  listDocumentKindContributions: () => [
    {
      kind: "conversation_mode",
      dir: "conversation_modes",
      pack: {
        images: (src: Record<string, unknown>) =>
          typeof src.box === "string" ? [{ asset: src.box, rise: 0 }] : [],
      },
    },
  ],
}));

const base = mockOpenProjects().projects[0]!;
const shop = { ...base, id: "p_shop" as typeof base.id, diskId: "shop", name: "Shop" };
const kit = {
  ...base,
  id: "p_kit" as typeof base.id,
  diskId: "artisan",
  name: "artisan",
  documents: {},
};
const read = (
  id: string,
  externalId: string,
  files: Record<string, string>,
  binaries: string[],
  role?: "theme",
) => ({
  summary: { id, externalId, name: externalId, hash: "h", serverKeyId: "sk1", role },
  files,
  binaries: binaries.map((path) => ({ path, hash: path, size: 1 })),
  failed: [],
  hash: "h",
});

beforeEach(() => {
  useServerIndexStore.setState({
    scope: "sk1",
    status: "ready",
    projects: [{ ...shop, documents: {} }, kit],
    failed: [],
    reads: [
      read(
        "p_shop",
        "shop",
        {
          "conversation_modes/hud.yml": "box: frame\n",
          "assets/textures/banner.yml":
            "width: 32\nheight: 16\ncompose:\n  - { use: kit:frame }\n  - { image: gold }\n",
        },
        ["assets/textures/gold.png"],
      ),
      read(
        "p_kit",
        "artisan",
        { "assets/textures/panel.yml": "width: 32\nheight: 16\ncompose:\n  - { image: frame }\n" },
        ["assets/textures/frame.png"],
        "theme",
      ),
    ],
  });
});

it("counts the composed images and the kinds' files that name an image, beside the menus", () => {
  const { result } = renderHook(() => useImageUses());
  const uses = result.current;
  expect(uses.get(commonImageKey("frame"))).toEqual([
    { projectId: "p_shop", projectName: "Shop", menuId: "", by: { kind: "image", name: "banner" } },
    {
      projectId: "p_shop",
      projectName: "Shop",
      menuId: "",
      by: { kind: "file", name: "conversation_modes/hud.yml" },
    },
    // A composed common image names the others of the common images.
    {
      projectId: "p_kit",
      projectName: "artisan",
      menuId: "",
      by: { kind: "image", name: "panel" },
    },
  ]);
  expect(uses.get(moduleImageKey("shop", "gold"))).toEqual([
    { projectId: "p_shop", projectName: "Shop", menuId: "", by: { kind: "image", name: "banner" } },
  ]);
  // No menu among them.
  expect(menusNamingCommon(uses)).toBe(0);
});

it("reads the composed images of the module being edited from its draft", () => {
  const { result } = renderHook(() =>
    useImageUses({
      project: { ...shop, documents: {} },
      own: ["gold"],
      composed: [{ name: "ribbon", refs: ["frame"] }],
    }),
  );
  expect(result.current.get(commonImageKey("frame"))?.map((use) => use.by?.name)).toEqual([
    "ribbon",
    // Its kinds' files are read as published.
    "conversation_modes/hud.yml",
    "panel",
  ]);
});

it("says what names an image", () => {
  const t = (key: string, options?: Record<string, unknown>) => `${key}:${options?.name ?? ""}`;
  const use = { projectId: "p", projectName: "P", menuId: "main" };
  expect(imageUseName(use, t)).toBe("main");
  expect(imageUseName({ ...use, menuId: "", by: { kind: "image", name: "banner" } }, t)).toBe(
    "resources.common.byImage:banner",
  );
  expect(imageUseName({ ...use, menuId: "", by: { kind: "file", name: "a/b.yml" } }, t)).toBe(
    "resources.common.byFile:a/b.yml",
  );
});
