import { afterEach, expect, it, vi } from "vitest";
import { publishDraft } from "./projectDrafts";

afterEach(() => vi.unstubAllGlobals());

it("retains the plugin explanation when publishing a draft fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "write_error",
          message: "AccessDeniedException: menus/shop.yaml",
        }),
        { status: 422 },
      ),
    ),
  );
  await expect(publishDraft("p1", "d1", 1, "op1")).rejects.toMatchObject({
    code: "write_error",
    status: 422,
    detail: "AccessDeniedException: menus/shop.yaml",
  });
});
