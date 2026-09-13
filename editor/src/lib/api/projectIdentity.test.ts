import { afterEach, expect, it, vi } from "vitest";
import { renameProject } from "./projectIdentity";

afterEach(() => vi.unstubAllGlobals());

it("classifies reserved names as a terminal rejection", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "destination_reserved" }), { status: 409 }),
      ),
  );
  await expect(
    renameProject("internal", { operationId: "operation", targetId: "old" }),
  ).rejects.toMatchObject({ message: "destination_reserved", terminal: true });
});

it("preserves a pending rename operation and sends the immutable project identity", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "rename_pending", operationId: "operation" }), {
        status: 202,
      }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          projectId: "internal",
          diskId: "new_folder",
          operationId: "operation",
        }),
      ),
    );
  vi.stubGlobal("fetch", request);
  const operation = { operationId: "operation", targetId: "new_folder" };
  expect(await renameProject("internal", operation)).toEqual({
    status: "pending",
    operationId: "operation",
  });
  expect(await renameProject("internal", operation)).toEqual({
    status: "complete",
    projectId: "internal",
    diskId: "new_folder",
    operationId: "operation",
  });
  expect(request).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining("/api/v1/projects/internal/rename"),
    expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify(operation),
    }),
  );
});
