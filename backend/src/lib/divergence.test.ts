import { describe, expect, test } from "vitest";
import { diffDivergence, mergeDivergence } from "./divergence";

const PID = "p_div";
const base = `plugins/Artisan/projects/${PID}`;

const web = {
  [`${base}/manifest.yaml`]: "schema: manifest/v1\n",
  [`${base}/menus/a.yaml`]: "id: a\ntitle: WEB\n",
  [`${base}/menus/web_only.yaml`]: "id: web_only\n",
  [`${base}/.artisan/editor.yaml`]: "schema: editor-state/v1\n",
};
const disk = {
  [`${base}/manifest.yaml`]: "schema: manifest/v1\n",
  [`${base}/menus/a.yaml`]: "id: a\ntitle: DISK\n",
  [`${base}/menus/disk_only.yaml`]: "id: disk_only\n",
};

describe("diffDivergence", () => {
  test("lists modified, disk-only and web-only files; identical and .artisan* excluded", () => {
    expect(diffDivergence(web, disk, PID)).toEqual([
      { path: "menus/a.yaml", disk: "id: a\ntitle: DISK\n", web: "id: a\ntitle: WEB\n" },
      { path: "menus/disk_only.yaml", disk: "id: disk_only\n", web: null },
      { path: "menus/web_only.yaml", disk: null, web: "id: web_only\n" },
    ]);
  });
});

describe("mergeDivergence", () => {
  test("choices apply per file; default is web; .artisan* always preserved", () => {
    const merged = mergeDivergence(web, disk, PID, {
      "menus/a.yaml": "disk",
      "menus/web_only.yaml": "disk", // deleted on disk → removed
      // menus/disk_only.yaml unchosen → web default → stays absent
    });
    expect(merged).toEqual({
      [`${base}/manifest.yaml`]: "schema: manifest/v1\n",
      [`${base}/menus/a.yaml`]: "id: a\ntitle: DISK\n",
      [`${base}/.artisan/editor.yaml`]: "schema: editor-state/v1\n",
    });
  });

  test("all-disk brings disk-only files in and drops web-only ones", () => {
    const merged = mergeDivergence(web, disk, PID, {
      "menus/a.yaml": "disk",
      "menus/disk_only.yaml": "disk",
      "menus/web_only.yaml": "disk",
    });
    expect(merged[`${base}/menus/disk_only.yaml`]).toBe("id: disk_only\n");
    expect(merged[`${base}/menus/web_only.yaml`]).toBeUndefined();
  });
});
