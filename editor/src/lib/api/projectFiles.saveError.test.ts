import { afterEach, expect, it, vi } from "vitest";
import { writeProjectFiles } from "./projectFiles";

afterEach(() => vi.unstubAllGlobals());

it("preserves an unknown server error code and HTTP status", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "disk_full", message: "No space left on device" }), {
          status: 507,
        }),
      ),
  );
  expect(await writeProjectFiles({ serverId: "s1", diskId: "p1" }, { files: [], deletes: [] })).toEqual({
    ok: false,
    error: "write_error",
    code: "disk_full",
    status: 507,
    message: "No space left on device",
  });
});
